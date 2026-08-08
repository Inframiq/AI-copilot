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

// ── Auth helper ───────────────────────────────────────────────────────────────

async function uid(): Promise<string> {
  const sb = createBrowserClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// ── Profile functions ─────────────────────────────────────────────────────────

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

// ── Connection functions ──────────────────────────────────────────────────────

export async function getMyConnections(): Promise<Profile[]> {
  const sb = createBrowserClient();
  const me = await uid();
  const { data, error } = await sb
    .from("connection_requests")
    .select("from_user, to_user, from_profile:profiles!connection_requests_from_user_fkey(*), to_profile:profiles!connection_requests_to_user_fkey(*)")
    .eq("status", "accepted")
    .or(`from_user.eq.${me},to_user.eq.${me}`);
  if (error) throw new Error(error.message);
  type Row = { from_user: string; to_user: string; from_profile: unknown; to_profile: unknown };
  return ((data ?? []) as unknown as Row[]).map((row) =>
    row.from_user === me ? (row.to_profile as Profile) : (row.from_profile as Profile)
  ).filter(Boolean);
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

export async function removeConnection(otherUserId: string): Promise<void> {
  const sb = createBrowserClient();
  const me = await uid();
  const { error } = await sb
    .from("connection_requests")
    .delete()
    .or(
      `and(from_user.eq.${me},to_user.eq.${otherUserId}),and(from_user.eq.${otherUserId},to_user.eq.${me})`
    );
  if (error) throw new Error(error.message);
}
