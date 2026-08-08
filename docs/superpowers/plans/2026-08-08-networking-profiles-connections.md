# Networking Profiles & Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user Profiles and Connections to the Networking page using Supabase as the backend, with 4 tabs: My Profile, Discover, My Network, and Requests.

**Architecture:** Two Supabase tables (`profiles`, `connection_requests`) with RLS, accessed via a typed client in `lib/networking-client.ts`. All state managed with React Query. The page shell in `networking/page.tsx` is rewritten to host 4 tabs; the existing local contact tracker is preserved in a collapsible section.

**Tech Stack:** Next.js 15 app router, Supabase (browser client via `@supabase/ssr`), React Query (`@tanstack/react-query`), Zustand (resume store for import), Phosphor Icons, Tailwind v4.

## Global Constraints

- All Supabase calls use `createBrowserClient()` from `@/lib/supabase` — never the service role key
- RLS must be enabled on both tables — no public access without auth
- No new npm packages — `@supabase/ssr` and `@tanstack/react-query` already installed
- Follow design tokens exactly: `bg-surface-container-lowest`, `rounded-2xl`, `text-primary`, `shadow-lg shadow-on-surface/5`, spacing tokens `p-lg`, `gap-md`, `gap-lg`, `p-gutter`
- TypeScript strict — no `any`, all Supabase rows typed via interfaces in `lib/networking-client.ts`
- Avatar = initials circle, color determined by `userId.charCodeAt(0) % AVATAR_COLORS.length`
- `staleTime: 60_000` on all React Query networking queries
- Existing external contacts (localStorage) section preserved, collapsed by default

---

## File Structure

```
apps/web/
  supabase/
    migrations/
      001_networking.sql          CREATE — SQL migration (run in Supabase dashboard)
  lib/
    networking-client.ts          CREATE — typed Supabase data access functions
  components/networking/
    ProfileCard.tsx               CREATE — reusable user profile card
    ProfileForm.tsx               CREATE — create/edit profile form
    ConnectionDrawer.tsx          CREATE — slide-over drawer for connection detail
  app/(app)/networking/
    page.tsx                      MODIFY — full rewrite: 4 tabs + collapsible contacts
  __tests__/
    networking-client.test.ts     CREATE — unit tests for networking-client helpers
```

---

### Task 1: Supabase Schema + Typed Client

**Files:**
- Create: `apps/web/supabase/migrations/001_networking.sql`
- Create: `apps/web/lib/networking-client.ts`
- Create: `apps/web/__tests__/networking-client.test.ts`

**Interfaces — Produces (used in Tasks 2–5):**
```ts
// from lib/networking-client.ts
export interface Profile {
  id: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  open_to_work: boolean;
  available_for: string[];
  linkedin_url: string | null;
  github_url: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileInput = Omit<Profile, 'id' | 'created_at' | 'updated_at'>;

export interface ConnectionRequest {
  id: string;
  from_user: string;
  to_user: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  profile: Profile; // joined — the OTHER user's profile
}

export type ConnectStatus = 'none' | 'pending' | 'accepted' | 'rejected_by_them';
```

- [ ] **Step 1: Write the SQL migration file**

Create `apps/web/supabase/migrations/001_networking.sql`:

```sql
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Profiles ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  headline      text,
  bio           text,
  location      text,
  skills        text[] DEFAULT '{}',
  open_to_work  boolean DEFAULT false,
  available_for text[] DEFAULT '{}',
  linkedin_url  text,
  github_url    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_authenticated"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "profiles_delete_own"
  ON profiles FOR DELETE TO authenticated USING (id = auth.uid());

-- ── Connection Requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connection_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (from_user, to_user)
);

ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conn_select_participant"
  ON connection_requests FOR SELECT TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());

CREATE POLICY "conn_insert_sender"
  ON connection_requests FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());

CREATE POLICY "conn_update_recipient"
  ON connection_requests FOR UPDATE TO authenticated
  USING (to_user = auth.uid());

CREATE POLICY "conn_delete_sender"
  ON connection_requests FOR DELETE TO authenticated
  USING (from_user = auth.uid());
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/__tests__/networking-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getInitials, getAvatarColor, AVATAR_COLORS } from "../lib/networking-client";

describe("networking-client helpers", () => {
  it("getInitials returns 2 uppercase letters", () => {
    expect(getInitials("Sarah Chen")).toBe("SC");
    expect(getInitials("John")).toBe("JO");
    expect(getInitials("Mary Jane Watson")).toBe("MJ");
  });

  it("getInitials handles single word", () => {
    expect(getInitials("Alice")).toBe("AL");
  });

  it("getAvatarColor returns a valid color string", () => {
    const color = getAvatarColor("some-uuid-123");
    expect(AVATAR_COLORS).toContain(color);
  });

  it("getAvatarColor is deterministic", () => {
    expect(getAvatarColor("abc")).toBe(getAvatarColor("abc"));
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd apps/web && npm test -- --reporter=verbose 2>&1 | grep -A5 "networking-client"
```
Expected: FAIL — `getInitials` and `getAvatarColor` not found.

- [ ] **Step 4: Create `apps/web/lib/networking-client.ts`**

```ts
import { createBrowserClient } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  open_to_work: boolean;
  available_for: string[];
  linkedin_url: string | null;
  github_url: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileInput = Omit<Profile, "id" | "created_at" | "updated_at">;

export interface ConnectionRequest {
  id: string;
  from_user: string;
  to_user: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  profile: Profile;
}

export type ConnectStatus = "none" | "pending" | "accepted" | "rejected_by_them";

// ── Avatar helpers (pure, exported for tests) ─────────────────────────────────

export const AVATAR_COLORS = [
  "bg-primary text-on-primary",
  "bg-secondary-container text-primary",
  "bg-surface-container-high text-on-surface",
  "bg-surface-variant text-primary",
  "bg-primary-container text-on-primary-container",
] as const;

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function getAvatarColor(userId: string): string {
  const code = userId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

// ── Supabase data functions ───────────────────────────────────────────────────

async function uid(): Promise<string> {
  const sb = createBrowserClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export async function getMyProfile(): Promise<Profile | null> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", me)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Profile | null;
}

export async function upsertProfile(input: ProfileInput): Promise<Profile> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("profiles")
    .upsert({ ...input, id: me, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function getAllProfiles(): Promise<Profile[]> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .neq("id", me)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getMyConnections(): Promise<Profile[]> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("connection_requests")
    .select("from_user, to_user, profiles!connection_requests_from_user_fkey(*), profiles!connection_requests_to_user_fkey(*)")
    .eq("status", "accepted")
    .or(`from_user.eq.${me},to_user.eq.${me}`);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    from_user: string;
    to_user: string;
    profiles: Profile[] | Profile;
  }>).map((row) => {
    // Return the OTHER person's profile
    const fromProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return fromProfile;
  }).filter(Boolean) as Profile[];
}

export async function getIncomingRequests(): Promise<ConnectionRequest[]> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("connection_requests")
    .select("*, profile:profiles!connection_requests_from_user_fkey(*)")
    .eq("to_user", me)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnectionRequest[];
}

export async function getOutgoingRequests(): Promise<ConnectionRequest[]> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("connection_requests")
    .select("*, profile:profiles!connection_requests_to_user_fkey(*)")
    .eq("from_user", me)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnectionRequest[];
}

export async function sendRequest(toUserId: string): Promise<void> {
  const sb = createBrowserClient();
  const me = await uid();
  const { error } = await sb
    .from("connection_requests")
    .insert({ from_user: me, to_user: toUserId, status: "pending" });
  if (error) throw new Error(error.message);
}

export async function acceptRequest(requestId: string): Promise<void> {
  const sb = createBrowserClient();
  const { error } = await sb
    .from("connection_requests")
    .update({ status: "accepted" })
    .eq("id", requestId);
  if (error) throw new Error(error.message);
}

export async function rejectRequest(requestId: string): Promise<void> {
  const sb = createBrowserClient();
  const { error } = await sb
    .from("connection_requests")
    .update({ status: "rejected" })
    .eq("id", requestId);
  if (error) throw new Error(error.message);
}

export async function cancelRequest(requestId: string): Promise<void> {
  const sb = createBrowserClient();
  const { error } = await sb
    .from("connection_requests")
    .delete()
    .eq("id", requestId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd apps/web && npm test -- --reporter=verbose 2>&1 | tail -15
```
Expected: 4 networking-client tests pass, 19 total pass.

---

### Task 2: ProfileCard + ProfileForm + ConnectionDrawer Components

**Files:**
- Create: `apps/web/components/networking/ProfileCard.tsx`
- Create: `apps/web/components/networking/ProfileForm.tsx`
- Create: `apps/web/components/networking/ConnectionDrawer.tsx`

**Interfaces:**
- Consumes: `Profile`, `ConnectStatus`, `getInitials`, `getAvatarColor` from `lib/networking-client`
- Produces:
  - `<ProfileCard profile={Profile} connectStatus={ConnectStatus} onConnect={() => void} onCancelRequest={() => void} onClick={() => void} />` — card used in Discover
  - `<ProfileForm initial={Profile | null} onSave={(input: ProfileInput) => Promise<void>} isSaving={boolean} error={string | null} />` — form used in My Profile tab
  - `<ConnectionDrawer profile={Profile | null} onClose={() => void} onRemove={() => Promise<void>} />` — slide-over used in My Network

- [ ] **Step 1: Create `apps/web/components/networking/ProfileCard.tsx`**

```tsx
"use client";
import { MapPin, SuitcaseSimple } from "@phosphor-icons/react";
import type { Profile, ConnectStatus } from "@/lib/networking-client";
import { getInitials, getAvatarColor } from "@/lib/networking-client";

interface Props {
  profile: Profile;
  connectStatus?: ConnectStatus;  // undefined = My Network mode (no button)
  onConnect?: () => void;
  onCancelRequest?: () => void;
  onClick?: () => void;
}

export function ProfileCard({ profile, connectStatus, onConnect, onCancelRequest, onClick }: Props) {
  const initials = getInitials(profile.display_name);
  const avatarColor = getAvatarColor(profile.id);
  const visibleSkills = profile.skills.slice(0, 4);
  const extraSkills = profile.skills.length - 4;

  return (
    <div
      onClick={onClick}
      className={`bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col gap-md ${onClick ? "cursor-pointer" : ""}`}
    >
      {/* Avatar + name */}
      <div className="flex items-start gap-md">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${avatarColor}`}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-sm flex-wrap">
            <p className="text-label-md text-on-surface font-semibold truncate">{profile.display_name}</p>
            {profile.open_to_work && (
              <span className="text-caption px-sm py-xs rounded-full bg-primary/10 text-primary font-semibold shrink-0">
                Open to Work
              </span>
            )}
          </div>
          {profile.headline && (
            <p className="text-caption text-on-surface-variant truncate">{profile.headline}</p>
          )}
        </div>
      </div>

      {/* Location */}
      {profile.location && (
        <div className="flex items-center gap-xs text-caption text-on-surface-variant">
          <MapPin size={12} />
          {profile.location}
        </div>
      )}

      {/* Skills */}
      {visibleSkills.length > 0 && (
        <div className="flex flex-wrap gap-xs">
          {visibleSkills.map((s) => (
            <span key={s} className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30">
              {s}
            </span>
          ))}
          {extraSkills > 0 && (
            <span className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30">
              +{extraSkills} more
            </span>
          )}
        </div>
      )}

      {/* Connect button — only shown in Discover mode */}
      {connectStatus !== undefined && (
        <div className="mt-auto pt-sm border-t border-outline-variant/20">
          {connectStatus === "none" && (
            <button
              onClick={(e) => { e.stopPropagation(); onConnect?.(); }}
              className="w-full py-sm rounded-xl text-label-sm text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              Connect
            </button>
          )}
          {connectStatus === "pending" && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancelRequest?.(); }}
              className="w-full py-sm rounded-xl text-label-sm text-on-surface-variant border border-outline-variant/40 hover:border-error/40 hover:text-error hover:bg-error-container/20 transition-all duration-200"
            >
              Pending · Cancel
            </button>
          )}
          {connectStatus === "accepted" && (
            <div className="w-full py-sm rounded-xl text-label-sm text-success-accent bg-primary/5 text-center border border-primary/10">
              ✓ Connected
            </div>
          )}
          {connectStatus === "rejected_by_them" && null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/networking/ProfileForm.tsx`**

```tsx
"use client";
import { useState, useEffect } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import type { Profile, ProfileInput } from "@/lib/networking-client";

interface Props {
  initial: Profile | null;
  onSave: (input: ProfileInput) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}

const AVAILABLE_FOR_OPTIONS = [
  { value: "full-time", label: "Full-time" },
  { value: "contract", label: "Contract" },
  { value: "mentoring", label: "Mentoring" },
];

const EMPTY: ProfileInput = {
  display_name: "",
  headline: null,
  bio: null,
  location: null,
  skills: [],
  open_to_work: false,
  available_for: [],
  linkedin_url: null,
  github_url: null,
};

export function ProfileForm({ initial, onSave, isSaving, error }: Props) {
  const resumeContent = useResumeStore((s) => s.content);
  const [form, setForm] = useState<ProfileInput>(initial ?? EMPTY);
  const [skillsText, setSkillsText] = useState((initial?.skills ?? []).join(", "));
  const [charCount, setCharCount] = useState((initial?.bio ?? "").length);

  // Keep skillsText in sync when initial changes
  useEffect(() => {
    if (initial) {
      setForm(initial);
      setSkillsText(initial.skills.join(", "));
      setCharCount((initial.bio ?? "").length);
    }
  }, [initial]);

  function handleImportFromResume() {
    if (!resumeContent) return;
    const name = resumeContent.contact?.name ?? "";
    const skills = Array.isArray(resumeContent.skills) ? resumeContent.skills : [];
    setForm((f) => ({ ...f, display_name: name || f.display_name, skills }));
    setSkillsText(skills.join(", "));
  }

  function parseSkills(text: string): string[] {
    return text.split(",").map((s) => s.trim()).filter(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({ ...form, skills: parseSkills(skillsText) });
  }

  const field = (label: string, key: keyof ProfileInput, placeholder: string, type = "text") => (
    <div className="flex flex-col gap-xs">
      <label className="text-label-sm text-on-surface-variant">{label}</label>
      <input
        type={type}
        value={(form[key] as string) ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value || null }))}
        placeholder={placeholder}
        className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      {/* Import from Resume */}
      {resumeContent && (
        <button
          type="button"
          onClick={handleImportFromResume}
          className="flex items-center gap-sm self-start px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-primary hover:bg-surface-container transition-all"
        >
          <DownloadSimple size={16} />
          Import name &amp; skills from Resume
        </button>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        {field("Display Name *", "display_name", "Your full name")}
        {field("Headline", "headline", "Senior SWE at Google")}
        {field("Location", "location", "San Francisco, CA")}
        {field("LinkedIn URL", "linkedin_url", "https://linkedin.com/in/you", "url")}
        {field("GitHub URL", "github_url", "https://github.com/you", "url")}
      </div>

      {/* Bio */}
      <div className="flex flex-col gap-xs">
        <label className="text-label-sm text-on-surface-variant flex justify-between">
          Bio
          <span className={charCount > 280 ? "text-error" : "text-on-surface-variant/60"}>{charCount}/300</span>
        </label>
        <textarea
          value={form.bio ?? ""}
          onChange={(e) => { setForm((f) => ({ ...f, bio: e.target.value || null })); setCharCount(e.target.value.length); }}
          maxLength={300}
          rows={3}
          placeholder="Tell people about yourself…"
          className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 resize-none transition-all"
        />
      </div>

      {/* Skills */}
      <div className="flex flex-col gap-xs">
        <label className="text-label-sm text-on-surface-variant">Skills (comma-separated)</label>
        <input
          value={skillsText}
          onChange={(e) => setSkillsText(e.target.value)}
          placeholder="React, TypeScript, Python…"
          className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
        />
        {parseSkills(skillsText).length > 0 && (
          <div className="flex flex-wrap gap-xs mt-xs">
            {parseSkills(skillsText).map((s) => (
              <span key={s} className="px-sm py-xs rounded-full bg-secondary-container text-primary text-caption">{s}</span>
            ))}
          </div>
        )}
      </div>

      {/* Open to Work */}
      <label className="flex items-center gap-md cursor-pointer">
        <div
          onClick={() => setForm((f) => ({ ...f, open_to_work: !f.open_to_work }))}
          className={`w-10 h-6 rounded-full transition-colors duration-200 flex items-center px-xs ${form.open_to_work ? "bg-primary" : "bg-surface-variant"}`}
        >
          <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${form.open_to_work ? "translate-x-4" : "translate-x-0"}`} />
        </div>
        <span className="text-label-md text-on-surface">Open to Work</span>
      </label>

      {/* Available For */}
      <div className="flex flex-col gap-xs">
        <span className="text-label-sm text-on-surface-variant">Available For</span>
        <div className="flex gap-sm flex-wrap">
          {AVAILABLE_FOR_OPTIONS.map(({ value, label }) => {
            const checked = form.available_for.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => setForm((f) => ({
                  ...f,
                  available_for: checked
                    ? f.available_for.filter((v) => v !== value)
                    : [...f.available_for, value],
                }))}
                className={`px-md py-sm rounded-xl text-label-sm transition-all border ${checked ? "bg-secondary-container text-primary border-primary/20 font-bold" : "border-outline-variant/40 text-on-surface-variant hover:bg-surface-container"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={isSaving || !form.display_name.trim()}
        className="w-full py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
      >
        {isSaving ? "Saving…" : "Save Profile"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Create `apps/web/components/networking/ConnectionDrawer.tsx`**

```tsx
"use client";
import { useEffect } from "react";
import { X, LinkedinLogo, GithubLogo, MapPin, Briefcase } from "@phosphor-icons/react";
import type { Profile } from "@/lib/networking-client";
import { getInitials, getAvatarColor } from "@/lib/networking-client";

interface Props {
  profile: Profile | null;
  onClose: () => void;
  onRemove: () => Promise<void>;
  isRemoving: boolean;
  removeArmed: boolean;
  onArmRemove: () => void;
}

export function ConnectionDrawer({ profile, onClose, onRemove, isRemoving, removeArmed, onArmRemove }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!profile) return null;

  const initials = getInitials(profile.display_name);
  const avatarColor = getAvatarColor(profile.id);

  const AVAILABLE_LABELS: Record<string, string> = {
    "full-time": "Full-time",
    contract: "Contract",
    mentoring: "Mentoring",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[420px] z-50 bg-surface-container-lowest border-l border-outline-variant/20 shadow-2xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-lg border-b border-outline-variant/20 shrink-0">
          <h2 className="text-headline-md text-on-surface font-semibold">Profile</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-lg p-lg flex-1">
          {/* Avatar + name */}
          <div className="flex items-center gap-md">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-headline-md shrink-0 ${avatarColor}`}>
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-sm flex-wrap">
                <p className="text-headline-md text-on-surface font-bold">{profile.display_name}</p>
                {profile.open_to_work && (
                  <span className="text-caption px-sm py-xs rounded-full bg-primary/10 text-primary font-semibold">Open to Work</span>
                )}
              </div>
              {profile.headline && <p className="text-body-sm text-on-surface-variant">{profile.headline}</p>}
            </div>
          </div>

          {/* Location */}
          {profile.location && (
            <div className="flex items-center gap-xs text-body-sm text-on-surface-variant">
              <MapPin size={16} />
              {profile.location}
            </div>
          )}

          {/* Bio */}
          {profile.bio && (
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">About</p>
              <p className="text-body-sm text-on-surface leading-relaxed">{profile.bio}</p>
            </div>
          )}

          {/* Skills */}
          {profile.skills.length > 0 && (
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-sm">Skills</p>
              <div className="flex flex-wrap gap-xs">
                {profile.skills.map((s) => (
                  <span key={s} className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Available For */}
          {profile.available_for.length > 0 && (
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-sm flex items-center gap-xs"><Briefcase size={14} /> Available For</p>
              <div className="flex gap-sm flex-wrap">
                {profile.available_for.map((v) => (
                  <span key={v} className="px-md py-sm rounded-xl text-label-sm bg-secondary-container text-primary border border-primary/10">{AVAILABLE_LABELS[v] ?? v}</span>
                ))}
              </div>
            </div>
          )}

          {/* Links */}
          <div className="flex gap-sm">
            {profile.linkedin_url && (
              <a href={profile.linkedin_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all">
                <LinkedinLogo size={16} /> LinkedIn
              </a>
            )}
            {profile.github_url && (
              <a href={profile.github_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all">
                <GithubLogo size={16} /> GitHub
              </a>
            )}
          </div>
        </div>

        {/* Remove connection */}
        <div className="p-lg border-t border-outline-variant/20 shrink-0">
          <button
            onClick={removeArmed ? onRemove : onArmRemove}
            disabled={isRemoving}
            className={`w-full py-md rounded-xl text-label-md transition-all ${removeArmed ? "bg-error text-on-error hover:opacity-90" : "border border-error/30 text-error hover:bg-error-container/20"}`}
          >
            {isRemoving ? "Removing…" : removeArmed ? "Confirm Remove Connection" : "Remove Connection"}
          </button>
          {removeArmed && (
            <p className="text-caption text-on-surface-variant text-center mt-xs">Click again to confirm. This cannot be undone.</p>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests to confirm they still pass**

```bash
cd apps/web && npm test 2>&1 | tail -8
```
Expected: 23 tests pass (19 original + 4 new networking-client tests).

---

### Task 3: My Profile Tab

**Files:**
- Modify: `apps/web/app/(app)/networking/page.tsx` — add tab shell + My Profile tab only (other tabs render placeholder)

**Interfaces:**
- Consumes: `getMyProfile`, `upsertProfile`, `ProfileInput`, `Profile` from `lib/networking-client`
- Consumes: `<ProfileForm />` from `components/networking/ProfileForm`
- Consumes: `<ProfileCard />` from `components/networking/ProfileCard` (display mode, no connectStatus)

- [ ] **Step 1: Rewrite `apps/web/app/(app)/networking/page.tsx`**

Replace the entire file with:

```tsx
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  UserCircle, Compass, Users, Bell,
  Plus, MagnifyingGlass, Clock, CheckCircle, Circle,
  ChevronDown, Trash, LinkedinLogo, EnvelopeSimple, X,
} from "@phosphor-icons/react";
import {
  getMyProfile, upsertProfile, getAllProfiles,
  getMyConnections, getIncomingRequests, getOutgoingRequests,
  sendRequest, acceptRequest, rejectRequest, cancelRequest,
  getInitials, getAvatarColor,
  type Profile, type ProfileInput, type ConnectStatus, type ConnectionRequest,
} from "@/lib/networking-client";
import { ProfileForm } from "@/components/networking/ProfileForm";
import { ProfileCard } from "@/components/networking/ProfileCard";
import { ConnectionDrawer } from "@/components/networking/ConnectionDrawer";

// ── Legacy contact types (localStorage) ────────────────────────────────────
interface Contact {
  id: string; name: string; role: string; company: string;
  status: "connected" | "following-up" | "new";
  lastContact: string; notes: string; email: string; linkedinUrl: string;
}
const STORAGE_KEY = "career-copilot-contacts";
const SEED_CONTACTS: Contact[] = [
  { id: "1", name: "Sarah Chen", role: "Engineering Manager", company: "Google", status: "connected", lastContact: new Date(Date.now() - 2 * 86400000).toISOString(), notes: "Met at SF Tech Meetup. Offered to refer.", email: "", linkedinUrl: "" },
  { id: "2", name: "Marcus Johnson", role: "Senior SWE", company: "Stripe", status: "following-up", lastContact: new Date(Date.now() - 7 * 86400000).toISOString(), notes: "Coffee chat scheduled.", email: "", linkedinUrl: "" },
  { id: "3", name: "Priya Patel", role: "Staff Engineer", company: "Airbnb", status: "new", lastContact: new Date().toISOString(), notes: "Connected after her talk on distributed systems.", email: "", linkedinUrl: "" },
];
function loadContacts(): Contact[] {
  if (typeof window === "undefined") return SEED_CONTACTS;
  try { const r = localStorage.getItem(STORAGE_KEY); if (!r) { localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_CONTACTS)); return SEED_CONTACTS; } return JSON.parse(r); } catch { return SEED_CONTACTS; }
}
function saveContacts(c: Contact[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); }
function formatDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "Today"; if (d === 1) return "Yesterday"; if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7); if (w === 1) return "1 week ago"; if (w < 5) return `${w} weeks ago`;
  const m = Math.floor(d / 30); return m === 1 ? "1 month ago" : `${m} months ago`;
}
const STATUS_CYCLE: Record<Contact["status"], Contact["status"]> = { new: "following-up", "following-up": "connected", connected: "new" };
const STATUS_CONFIG: Record<Contact["status"], { label: string; color: string }> = {
  connected: { label: "Connected", color: "text-success-accent bg-primary/10" },
  "following-up": { label: "Follow Up", color: "text-secondary bg-surface-container-high" },
  new: { label: "New", color: "text-primary bg-secondary-container" },
};

// ── Tab type ────────────────────────────────────────────────────────────────
type Tab = "profile" | "discover" | "network" | "requests";

export default function NetworkingPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [editingProfile, setEditingProfile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discoverSearch, setDiscoverSearch] = useState("");
  const [networkSearch, setNetworkSearch] = useState("");
  const [drawerProfile, setDrawerProfile] = useState<Profile | null>(null);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", role: "", company: "", status: "new" as Contact["status"], notes: "", email: "", linkedinUrl: "" });
  const [contactFormError, setContactFormError] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: myProfile = null } = useQuery({ queryKey: ["myProfile"], queryFn: getMyProfile, staleTime: 60_000 });
  const { data: allProfiles = [], isError: discoverError, refetch: refetchDiscover } = useQuery({ queryKey: ["allProfiles"], queryFn: getAllProfiles, staleTime: 60_000, enabled: activeTab === "discover" });
  const { data: myConnections = [] } = useQuery({ queryKey: ["myConnections"], queryFn: getMyConnections, staleTime: 60_000, enabled: activeTab === "network" });
  const { data: incoming = [] } = useQuery({ queryKey: ["incomingRequests"], queryFn: getIncomingRequests, staleTime: 60_000 });
  const { data: outgoing = [] } = useQuery({ queryKey: ["outgoingRequests"], queryFn: getOutgoingRequests, staleTime: 60_000, enabled: activeTab === "requests" });

  // ── Derived connect status map for Discover ──────────────────────────────
  const connectStatusMap: Record<string, ConnectStatus> = {};
  incoming.forEach((r) => { connectStatusMap[r.from_user] = r.status === "accepted" ? "accepted" : r.status === "rejected" ? "rejected_by_them" : "pending"; });
  outgoing.forEach((r) => { connectStatusMap[r.to_user] = r.status === "accepted" ? "accepted" : r.status === "rejected" ? "rejected_by_them" : "pending"; });
  myConnections.forEach((p) => { connectStatusMap[p.id] = "accepted"; });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: upsertProfile,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["myProfile"] }); setEditingProfile(false); setSaveError(null); },
    onError: (e: Error) => setSaveError(e.message),
  });

  const connectMutation = useMutation({
    mutationFn: sendRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outgoingRequests", "allProfiles"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outgoingRequests"] }),
  });

  const acceptMutation = useMutation({
    mutationFn: acceptRequest,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["incomingRequests", "myConnections"] }); },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incomingRequests"] }),
  });

  async function handleRemoveConnection() {
    if (!drawerProfile) return;
    setIsRemoving(true);
    // Find the connection request row id — accepted request involving this user
    // Since we only have profiles in myConnections, we delete via a fresh query
    const sb = (await import("@/lib/supabase")).createBrowserClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    await sb.from("connection_requests").delete()
      .or(`and(from_user.eq.${user.id},to_user.eq.${drawerProfile.id}),and(from_user.eq.${drawerProfile.id},to_user.eq.${user.id})`);
    qc.invalidateQueries({ queryKey: ["myConnections"] });
    setIsRemoving(false);
    setDrawerProfile(null);
    setRemoveArmed(false);
  }

  const pendingIncoming = incoming.length;

  // ── Filtered lists ────────────────────────────────────────────────────────
  const filteredDiscover = allProfiles.filter((p) => {
    if (connectStatusMap[p.id] === "rejected_by_them") return false;
    const q = discoverSearch.toLowerCase();
    return !q || p.display_name.toLowerCase().includes(q) || (p.headline ?? "").toLowerCase().includes(q) || p.skills.some((s) => s.toLowerCase().includes(q));
  });

  const filteredNetwork = myConnections.filter((p) => {
    const q = networkSearch.toLowerCase();
    return !q || p.display_name.toLowerCase().includes(q) || (p.headline ?? "").toLowerCase().includes(q) || p.skills.some((s) => s.toLowerCase().includes(q));
  });

  // ── Contact helpers ───────────────────────────────────────────────────────
  function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.role.trim() || !contactForm.company.trim()) { setContactFormError("Name, Role, and Company are required."); return; }
    const c: Contact = { id: Date.now().toString(), ...contactForm, name: contactForm.name.trim(), role: contactForm.role.trim(), company: contactForm.company.trim(), notes: contactForm.notes.trim(), email: contactForm.email.trim(), linkedinUrl: contactForm.linkedinUrl.trim(), lastContact: new Date().toISOString() };
    const updated = [...contacts, c]; setContacts(updated); saveContacts(updated);
    setShowAddContact(false); setContactForm({ name: "", role: "", company: "", status: "new", notes: "", email: "", linkedinUrl: "" }); setContactFormError("");
  }
  function handleDeleteContact(id: string) {
    if (deleteConfirm === id) { const u = contacts.filter((c) => c.id !== id); setContacts(u); saveContacts(u); setDeleteConfirm(null); } else setDeleteConfirm(id);
  }
  function handleCycleStatus(id: string) {
    const u = contacts.map((c) => c.id === id ? { ...c, status: STATUS_CYCLE[c.status] } : c); setContacts(u); saveContacts(u);
  }

  // ── Tab config ────────────────────────────────────────────────────────────
  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "profile", label: "My Profile" },
    { id: "discover", label: "Discover" },
    { id: "network", label: "My Network" },
    { id: "requests", label: "Requests", badge: pendingIncoming },
  ];

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Header */}
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface font-bold mb-sm" style={{ letterSpacing: "-0.02em" }}>Networking</h1>
        <p className="text-body-lg text-on-surface-variant">Connect with other Career Copilot users and grow your professional network.</p>
      </section>

      {/* Tabs */}
      <div className="flex gap-lg border-b border-outline-variant/30">
        {tabs.map(({ id, label, badge }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`pb-sm text-label-md transition-all duration-200 whitespace-nowrap flex items-center gap-xs ${activeTab === id ? "text-primary font-bold border-b-2 border-primary" : "text-on-surface-variant hover:text-on-surface"}`}>
            {label}
            {badge != null && badge > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-caption flex items-center justify-center font-bold">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── MY PROFILE TAB ─────────────────────────────────────────────────── */}
      {activeTab === "profile" && (
        <div className="max-w-2xl">
          {!myProfile || editingProfile ? (
            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
              {!myProfile && (
                <div className="mb-lg">
                  <h2 className="text-headline-md text-on-surface font-semibold mb-xs">Set up your profile</h2>
                  <p className="text-body-sm text-on-surface-variant">Create your public profile so others can find and connect with you.</p>
                </div>
              )}
              {myProfile && editingProfile && (
                <div className="flex items-center justify-between mb-lg">
                  <h2 className="text-headline-md text-on-surface font-semibold">Edit Profile</h2>
                  <button onClick={() => { setEditingProfile(false); setSaveError(null); }} className="text-label-sm text-on-surface-variant hover:text-on-surface">Cancel</button>
                </div>
              )}
              <ProfileForm
                initial={editingProfile ? myProfile : null}
                onSave={async (input: ProfileInput) => { await saveMutation.mutateAsync(input); }}
                isSaving={saveMutation.isPending}
                error={saveError}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-lg">
              {/* Profile preview card */}
              <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
                <div className="flex items-start justify-between mb-lg">
                  <h2 className="text-headline-md text-on-surface font-semibold">Your Profile</h2>
                  <button onClick={() => setEditingProfile(true)} className="text-label-sm text-primary hover:underline">Edit Profile</button>
                </div>
                <div className="flex items-center gap-md mb-lg">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-headline-md shrink-0 ${getAvatarColor(myProfile.id)}`}>
                    {getInitials(myProfile.display_name)}
                  </div>
                  <div>
                    <div className="flex items-center gap-sm flex-wrap">
                      <p className="text-headline-md text-on-surface font-bold">{myProfile.display_name}</p>
                      {myProfile.open_to_work && <span className="text-caption px-sm py-xs rounded-full bg-primary/10 text-primary font-semibold">Open to Work</span>}
                    </div>
                    {myProfile.headline && <p className="text-body-sm text-on-surface-variant">{myProfile.headline}</p>}
                    {myProfile.location && <p className="text-caption text-on-surface-variant">{myProfile.location}</p>}
                  </div>
                </div>
                {myProfile.bio && <p className="text-body-sm text-on-surface mb-lg leading-relaxed">{myProfile.bio}</p>}
                {myProfile.skills.length > 0 && (
                  <div className="flex flex-wrap gap-xs mb-lg">
                    {myProfile.skills.map((s) => <span key={s} className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30">{s}</span>)}
                  </div>
                )}
                {myProfile.available_for.length > 0 && (
                  <div className="flex gap-sm flex-wrap">
                    {myProfile.available_for.map((v) => <span key={v} className="px-md py-sm rounded-xl text-label-sm bg-secondary-container text-primary">{v === "full-time" ? "Full-time" : v === "contract" ? "Contract" : "Mentoring"}</span>)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DISCOVER TAB ────────────────────────────────────────────────────── */}
      {activeTab === "discover" && (
        <div className="flex flex-col gap-lg">
          {!myProfile ? (
            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col items-center justify-center py-xxl gap-md text-center">
              <p className="text-body-md text-on-surface font-medium">Create your profile first</p>
              <p className="text-body-sm text-on-surface-variant">Set up your profile to start connecting with others.</p>
              <button onClick={() => setActiveTab("profile")} className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200">
                Go to My Profile
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-md py-sm gap-sm">
                <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
                <input value={discoverSearch} onChange={(e) => setDiscoverSearch(e.target.value)} placeholder="Search by name, headline, or skill…" className="bg-transparent border-none outline-none text-body-sm text-on-surface w-full placeholder:text-on-surface-variant/60" />
              </div>
              {discoverError ? (
                <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 flex flex-col items-center gap-md py-xxl text-center">
                  <p className="text-body-md text-on-surface font-medium">Failed to load profiles</p>
                  <button onClick={() => refetchDiscover()} className="text-label-sm text-primary hover:underline">Retry</button>
                </div>
              ) : filteredDiscover.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-xxl gap-md text-center">
                  <p className="text-body-md text-on-surface font-medium">{discoverSearch ? "No matching profiles" : "No other users yet"}</p>
                  <p className="text-body-sm text-on-surface-variant">{discoverSearch ? "Try a different search term." : "Invite colleagues to join Career Copilot."}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
                  {filteredDiscover.map((p) => {
                    const status = connectStatusMap[p.id] ?? "none";
                    const outReq = outgoing.find((r) => r.to_user === p.id);
                    return (
                      <ProfileCard
                        key={p.id}
                        profile={p}
                        connectStatus={status}
                        onConnect={() => connectMutation.mutate(p.id)}
                        onCancelRequest={() => outReq && cancelMutation.mutate(outReq.id)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── MY NETWORK TAB ──────────────────────────────────────────────────── */}
      {activeTab === "network" && (
        <div className="flex flex-col gap-lg">
          <div className="flex items-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-md py-sm gap-sm">
            <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
            <input value={networkSearch} onChange={(e) => setNetworkSearch(e.target.value)} placeholder="Search connections…" className="bg-transparent border-none outline-none text-body-sm text-on-surface w-full placeholder:text-on-surface-variant/60" />
          </div>
          {filteredNetwork.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-xxl gap-md text-center">
              <p className="text-body-md text-on-surface font-medium">{networkSearch ? "No matching connections" : "No connections yet"}</p>
              <p className="text-body-sm text-on-surface-variant">{networkSearch ? "Try a different search." : "Head to Discover to find people."}</p>
              {!networkSearch && <button onClick={() => setActiveTab("discover")} className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200">Go to Discover</button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {filteredNetwork.map((p) => (
                <ProfileCard key={p.id} profile={p} onClick={() => { setDrawerProfile(p); setRemoveArmed(false); }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── REQUESTS TAB ────────────────────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div className="flex flex-col gap-xl">
          {/* Incoming */}
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold mb-lg">Incoming Requests</h2>
            {incoming.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-center py-xl">
                <p className="text-body-sm text-on-surface-variant">No pending requests</p>
              </div>
            ) : (
              <div className="flex flex-col gap-md">
                {incoming.map((req) => (
                  <div key={req.id} className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center gap-md">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${getAvatarColor(req.profile.id)}`}>
                      {getInitials(req.profile.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-label-md text-on-surface font-semibold truncate">{req.profile.display_name}</p>
                      {req.profile.headline && <p className="text-caption text-on-surface-variant truncate">{req.profile.headline}</p>}
                    </div>
                    <div className="flex gap-sm shrink-0">
                      <button onClick={() => acceptMutation.mutate(req.id)} className="px-md py-sm rounded-xl text-label-sm text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-200">Accept</button>
                      <button onClick={() => rejectMutation.mutate(req.id)} className="px-md py-sm rounded-xl text-label-sm border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container transition-all">Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outgoing */}
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold mb-lg">Outgoing Requests</h2>
            {outgoing.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-center py-xl">
                <p className="text-body-sm text-on-surface-variant">No outgoing requests</p>
              </div>
            ) : (
              <div className="flex flex-col gap-md">
                {outgoing.map((req) => (
                  <div key={req.id} className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center gap-md">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${getAvatarColor(req.profile.id)}`}>
                      {getInitials(req.profile.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-label-md text-on-surface font-semibold truncate">{req.profile.display_name}</p>
                      {req.profile.headline && <p className="text-caption text-on-surface-variant truncate">{req.profile.headline}</p>}
                    </div>
                    <button onClick={() => cancelMutation.mutate(req.id)} className="px-md py-sm rounded-xl text-label-sm border border-outline-variant/40 text-on-surface-variant hover:border-error/40 hover:text-error transition-all shrink-0">Cancel</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CONNECTION DRAWER ─────────────────────────────────────────────── */}
      {drawerProfile && (
        <ConnectionDrawer
          profile={drawerProfile}
          onClose={() => { setDrawerProfile(null); setRemoveArmed(false); }}
          onRemove={handleRemoveConnection}
          isRemoving={isRemoving}
          removeArmed={removeArmed}
          onArmRemove={() => setRemoveArmed(true)}
        />
      )}

      {/* ── EXTERNAL CONTACTS (collapsible) ──────────────────────────────── */}
      <div className="border-t border-outline-variant/20 pt-lg">
        <button onClick={() => setContactsOpen((o) => !o)} className="flex items-center gap-sm text-label-md text-on-surface-variant hover:text-on-surface transition-colors mb-md">
          <ChevronDown size={18} className={`transition-transform duration-200 ${contactsOpen ? "rotate-180" : ""}`} />
          External Contacts ({contacts.length})
        </button>

        {contactsOpen && (
          <div className="flex flex-col gap-lg">
            <button onClick={() => setShowAddContact(true)} className="flex items-center gap-sm self-start px-lg py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200">
              <Plus size={18} /> Add External Contact
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {contacts.map((contact, i) => {
                const { label, color } = STATUS_CONFIG[contact.status];
                const AVATAR_COLORS_LEGACY = ["bg-primary text-on-primary","bg-secondary-container text-primary","bg-surface-container-high text-on-surface","bg-surface-variant text-primary","bg-primary-container text-on-primary"];
                return (
                  <div key={contact.id} className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col gap-md">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-md">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${AVATAR_COLORS_LEGACY[i % AVATAR_COLORS_LEGACY.length]}`}>
                          {getInitials(contact.name)}
                        </div>
                        <div>
                          <p className="text-label-md text-on-surface font-semibold">{contact.name}</p>
                          <p className="text-caption text-on-surface-variant">{contact.role} @ {contact.company}</p>
                        </div>
                      </div>
                      <button onClick={() => handleCycleStatus(contact.id)} className={`text-caption px-sm py-xs rounded-full font-semibold shrink-0 cursor-pointer hover:opacity-80 transition-opacity ${color}`}>{label}</button>
                    </div>
                    <p className="text-body-sm text-on-surface-variant flex-1">{contact.notes || "No notes yet."}</p>
                    <div className="flex items-center justify-between pt-sm border-t border-outline-variant/20">
                      <div className="flex items-center gap-xs text-caption text-on-surface-variant"><Clock size={12} />{formatDate(contact.lastContact)}</div>
                      <div className="flex gap-sm">
                        <button onClick={() => contact.linkedinUrl ? window.open(contact.linkedinUrl, "_blank") : undefined} className={`w-8 h-8 rounded-full bg-surface-container flex items-center justify-center transition-colors ${contact.linkedinUrl ? "text-on-surface-variant hover:text-primary cursor-pointer" : "text-outline-variant cursor-not-allowed opacity-50"}`}><LinkedinLogo size={16} /></button>
                        <button onClick={() => contact.email ? window.open(`mailto:${contact.email}`) : undefined} className={`w-8 h-8 rounded-full bg-surface-container flex items-center justify-center transition-colors ${contact.email ? "text-on-surface-variant hover:text-primary cursor-pointer" : "text-outline-variant cursor-not-allowed opacity-50"}`}><EnvelopeSimple size={16} /></button>
                        <button onClick={() => handleDeleteContact(contact.id)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${deleteConfirm === contact.id ? "bg-error text-on-primary" : "bg-surface-container hover:bg-error-container/50 text-on-surface-variant hover:text-error"}`}><Trash size={16} /></button>
                      </div>
                    </div>
                    {deleteConfirm === contact.id && <p className="text-caption text-error text-center">Click trash again to confirm</p>}
                  </div>
                );
              })}
              {contacts.length === 0 && <div className="col-span-full text-center py-xl"><p className="text-body-sm text-on-surface-variant">No external contacts. Add one above.</p></div>}
            </div>
          </div>
        )}
      </div>

      {/* Add External Contact Modal */}
      {showAddContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-gutter bg-on-surface/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) { setShowAddContact(false); setContactFormError(""); } }}>
          <div className="bg-surface-container-lowest rounded-2xl p-xl border border-outline-variant/20 shadow-lg w-full max-w-[480px] flex flex-col gap-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-headline-md text-on-surface font-semibold">Add External Contact</h2>
              <button onClick={() => { setShowAddContact(false); setContactFormError(""); }} className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddContact} className="flex flex-col gap-md">
              {contactFormError && <p className="text-body-sm text-error">{contactFormError}</p>}
              {[{ label: "Name *", key: "name", placeholder: "Jane Smith" }, { label: "Role *", key: "role", placeholder: "Senior Engineer" }, { label: "Company *", key: "company", placeholder: "Acme Corp" }, { label: "Email", key: "email", placeholder: "jane@example.com" }, { label: "LinkedIn URL", key: "linkedinUrl", placeholder: "https://linkedin.com/in/jane" }].map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">{label}</label>
                  <input value={contactForm[key as keyof typeof contactForm]} onChange={(e) => setContactForm((f) => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary" />
                </div>
              ))}
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Notes</label>
                <textarea value={contactForm.notes} onChange={(e) => setContactForm((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="How you met…" className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div className="flex gap-md pt-sm">
                <button type="button" onClick={() => { setShowAddContact(false); setContactFormError(""); }} className="flex-1 py-md rounded-xl border border-outline-variant/30 text-label-md text-on-surface-variant hover:bg-surface-container transition-all">Cancel</button>
                <button type="submit" className="flex-1 py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200">Add Contact</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit 2>&1
```
Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

```bash
cd apps/web && npm test 2>&1 | tail -10
```
Expected: 23 tests pass.
