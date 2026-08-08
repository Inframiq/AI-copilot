# Networking — Profiles & Connections Design

**Date:** 2026-08-08
**Status:** Approved

---

## Goal

Transform the Networking page from a single-user local contact tracker into a real multi-user social layer where Career Copilot users can create public profiles, discover each other, and send/accept/reject connection requests.

## Architecture

**Data layer:** Two Supabase tables accessed directly from Next.js via the existing `createBrowserClient()`. No FastAPI changes.

### Table: `profiles`

```sql
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  headline      text,
  bio           text,
  location      text,
  skills        text[] DEFAULT '{}',
  open_to_work  boolean DEFAULT false,
  available_for text[] DEFAULT '{}',  -- "full-time" | "contract" | "mentoring"
  linkedin_url  text,
  github_url    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
```

### Table: `connection_requests`

```sql
CREATE TABLE connection_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (from_user, to_user)
);
```

### Row Level Security

**profiles:**
- `SELECT`: authenticated users can read all rows
- `INSERT`: only where `id = auth.uid()`
- `UPDATE`: only where `id = auth.uid()`
- `DELETE`: only where `id = auth.uid()`

**connection_requests:**
- `SELECT`: rows where `from_user = auth.uid()` OR `to_user = auth.uid()`
- `INSERT`: only where `from_user = auth.uid()`
- `UPDATE`: only where `to_user = auth.uid()` (accept/reject by recipient only)
- `DELETE`: only where `from_user = auth.uid()` (cancel outgoing by sender only)

---

## Data Access Layer

New file: `lib/networking-client.ts`

Exports typed async functions using the Supabase browser client:

```ts
getMyProfile(): Promise<Profile | null>
upsertProfile(data: ProfileInput): Promise<Profile>
getAllProfiles(): Promise<Profile[]>          // excludes current user
getMyConnections(): Promise<Profile[]>        // accepted connections
getIncomingRequests(): Promise<ConnectionRequest[]>
getOutgoingRequests(): Promise<ConnectionRequest[]>
sendRequest(toUserId: string): Promise<void>
acceptRequest(requestId: string): Promise<void>
rejectRequest(requestId: string): Promise<void>
cancelRequest(requestId: string): Promise<void>
```

Each function throws with a human-readable message on Supabase error.

---

## UI — Page Structure

`app/(app)/networking/page.tsx` is rewritten. Four tabs replace the current layout.

### Tab 1: My Profile

**If no profile exists:** full-width onboarding card with headline "Set up your profile" and a short explanation, then the profile form below.

**If profile exists:** read-only profile card at the top (same visual as Discover cards but larger), with an "Edit Profile" button that swaps it for the editable form.

**Profile form fields:**
| Field | Type | Required |
|-------|------|----------|
| Display Name | text input | yes |
| Headline | text input (e.g. "Senior SWE at Google") | no |
| Bio | textarea (max 300 chars, char counter) | no |
| Location | text input | no |
| Skills | text input → comma-separated → renders chips | no |
| Open to Work | toggle switch | no |
| Available For | checkboxes: Full-time / Contract / Mentoring | no |
| LinkedIn URL | url input | no |
| GitHub URL | url input | no |

**"Import from Resume" button:** copies `content.contact.name` → Display Name and `content.skills[]` → Skills from the Zustand resume store. Fields are editable after import. Button is disabled if no resume is loaded in the store.

**Save:** calls `upsertProfile()`, shows inline success/error. Updated profile card appears immediately (optimistic update).

---

### Tab 2: Discover

**Guard:** If current user has no profile, shows a prompt card: "Create your profile first to start connecting." with a link to the My Profile tab.

**Layout:** Responsive grid (1 col mobile / 2 col md / 3 col lg) of profile cards.

**Profile card:**
- Avatar circle: initials + deterministic color from user id
- Display name + headline
- Location (if set)
- Open to Work badge (green pill) if `open_to_work = true`
- Up to 4 skill chips, "+N more" if there are additional skills
- Connect button — states:
  - **Connect** (default): sends request, button becomes "Pending" immediately (optimistic)
  - **Pending**: outgoing request exists, click to cancel (with confirmation tooltip)
  - **Connected**: already accepted, button disabled with checkmark

**Search bar** at top filters by name, headline, or skills client-side.

Excludes: current user's own profile, and users who have rejected the current user's request (they disappear from Discover).

---

### Tab 3: My Network

Grid of accepted connections using the same card layout as Discover, minus the Connect button.

**Click a card** → opens a slide-over drawer (right side, overlays content) with:
- Full profile: all fields including bio, available-for, LinkedIn/GitHub links
- "View LinkedIn" button (if url set) — opens in new tab
- "Remove Connection" button at the bottom (with confirmation state: click once to arm, click again to confirm)

**Search bar** filters by name, headline, or skills.

Empty state: "No connections yet. Head to Discover to find people."

---

### Tab 4: Requests

**Badge:** Tab label shows count of pending incoming requests (e.g. "Requests (3)"). Badge disappears when count is 0.

**Two sections:**

*Incoming:*
- Each row: avatar, name, headline, "Accept" button (primary), "Decline" button (outlined)
- Accept → moves person to My Network, row disappears
- Decline → row disappears, person is hidden from Discover for them
- Empty state: "No pending requests"

*Outgoing:*
- Each row: avatar, name, headline, "Cancel" button
- Cancel → row disappears, connect button resets in Discover
- Empty state: "No outgoing requests"

---

### External Contacts (preserved)

The existing local contact tracker (localStorage, current page content) moves to a collapsible section at the bottom of the page, collapsed by default. Heading: "External Contacts" with a chevron toggle. All existing functionality is unchanged.

---

## State Management

No new Zustand store. All networking state is fetched with React Query:

```ts
queryKey: ["myProfile"]          // getMyProfile()
queryKey: ["allProfiles"]        // getAllProfiles()
queryKey: ["myConnections"]      // getMyConnections()
queryKey: ["incomingRequests"]   // getIncomingRequests()
queryKey: ["outgoingRequests"]   // getOutgoingRequests()
```

Mutations use `useMutation` + `queryClient.invalidateQueries()` on success to keep all tabs in sync. Optimistic updates on the Connect button state in Discover for snappy UX.

`staleTime: 60_000` on all queries (1 minute) — social data doesn't need to be real-time.

---

## Error Handling

- Supabase errors surface as inline error text below the relevant action (form save, connect button, accept/reject)
- Network errors on connect/accept/reject roll back the optimistic update and show a toast-style inline error
- If `getAllProfiles()` fails, Discover shows an error card with a retry button

---

## Global Constraints

- Supabase tables must be created via SQL before the frontend code runs (migration SQL included in Task 1)
- All Supabase calls use `createBrowserClient()` from `@/lib/supabase` — never the service role key
- RLS must be enabled on both tables before any data is written
- Follows existing design system: `bg-surface-container-lowest`, `text-primary`, `rounded-2xl`, `shadow-lg`, spacing tokens from `globals.css`
- No new npm packages beyond what's already installed (`@supabase/supabase-js` already present)
- TypeScript strict — all Supabase responses typed with local interfaces in `lib/networking-client.ts`
- Existing external contacts section (localStorage) is preserved and functional
