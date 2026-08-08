"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  MagnifyingGlass,
  Clock,
  LinkedinLogo,
  EnvelopeSimple,
  Trash,
  X,
  CaretDown,
} from "@phosphor-icons/react";
import {
  getMyProfile,
  upsertProfile,
  getAllProfiles,
  getMyConnections,
  getIncomingRequests,
  getOutgoingRequests,
  sendRequest,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  removeConnection,
  getInitials,
  getAvatarColor,
  type Profile,
  type ProfileInput,
  type ConnectStatus,
} from "@/lib/networking-client";
import { ProfileForm } from "@/components/networking/ProfileForm";
import { ProfileCard } from "@/components/networking/ProfileCard";
import { ConnectionDrawer } from "@/components/networking/ConnectionDrawer";

// ── Legacy local contact tracker ─────────────────────────────────────────────

interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  status: "connected" | "following-up" | "new";
  lastContact: string;
  notes: string;
  email: string;
  linkedinUrl: string;
}

const STORAGE_KEY = "career-copilot-contacts";
const SEED_CONTACTS: Contact[] = [
  { id: "1", name: "Sarah Chen", role: "Engineering Manager", company: "Google", status: "connected", lastContact: new Date(Date.now() - 2 * 86400000).toISOString(), notes: "Met at SF Tech Meetup. Offered to refer.", email: "", linkedinUrl: "" },
  { id: "2", name: "Marcus Johnson", role: "Senior SWE", company: "Stripe", status: "following-up", lastContact: new Date(Date.now() - 7 * 86400000).toISOString(), notes: "Coffee chat scheduled.", email: "", linkedinUrl: "" },
  { id: "3", name: "Priya Patel", role: "Staff Engineer", company: "Airbnb", status: "new", lastContact: new Date().toISOString(), notes: "Connected after her talk on distributed systems.", email: "", linkedinUrl: "" },
];

function loadContacts(): Contact[] {
  if (typeof window === "undefined") return SEED_CONTACTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_CONTACTS)); return SEED_CONTACTS; }
    return JSON.parse(raw);
  } catch { return SEED_CONTACTS; }
}

function saveContacts(c: Contact[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

function formatDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  if (w === 1) return "1 week ago";
  if (w < 5) return `${w} weeks ago`;
  const m = Math.floor(d / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

const STATUS_CYCLE: Record<Contact["status"], Contact["status"]> = {
  new: "following-up",
  "following-up": "connected",
  connected: "new",
};

const STATUS_CONFIG: Record<Contact["status"], { label: string; color: string }> = {
  connected: { label: "Connected", color: "text-success-accent bg-primary/10" },
  "following-up": { label: "Follow Up", color: "text-secondary bg-surface-container-high" },
  new: { label: "New", color: "text-primary bg-secondary-container" },
};

const LEGACY_AVATAR_COLORS = [
  "bg-primary text-on-primary",
  "bg-secondary-container text-primary",
  "bg-surface-container-high text-on-surface",
  "bg-surface-variant text-primary",
  "bg-primary-container text-on-primary-container",
];

const EMPTY_CONTACT_FORM = { name: "", role: "", company: "", status: "new" as Contact["status"], notes: "", email: "", linkedinUrl: "" };

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = "profile" | "discover" | "network" | "requests";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NetworkingPage() {
  const qc = useQueryClient();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Discover / network search
  const [discoverSearch, setDiscoverSearch] = useState("");
  const [networkSearch, setNetworkSearch] = useState("");

  // Connection drawer
  const [drawerProfile, setDrawerProfile] = useState<Profile | null>(null);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // External contacts
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT_FORM);
  const [contactFormError, setContactFormError] = useState("");

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: myProfile = null } = useQuery({
    queryKey: ["myProfile"],
    queryFn: getMyProfile,
    staleTime: 60_000,
  });

  const {
    data: allProfiles = [],
    isError: discoverError,
    refetch: refetchDiscover,
  } = useQuery({
    queryKey: ["allProfiles"],
    queryFn: getAllProfiles,
    staleTime: 60_000,
    enabled: activeTab === "discover",
  });

  const { data: myConnections = [] } = useQuery({
    queryKey: ["myConnections"],
    queryFn: getMyConnections,
    staleTime: 60_000,
    enabled: activeTab === "network",
  });

  const { data: incoming = [] } = useQuery({
    queryKey: ["incomingRequests"],
    queryFn: getIncomingRequests,
    staleTime: 60_000,
  });

  const { data: outgoing = [] } = useQuery({
    queryKey: ["outgoingRequests"],
    queryFn: getOutgoingRequests,
    staleTime: 60_000,
    enabled: activeTab === "requests" || activeTab === "discover",
  });

  // ── Connect status map ───────────────────────────────────────────────────────
  const connectStatusMap: Record<string, ConnectStatus> = {};
  incoming.forEach((r) => {
    connectStatusMap[r.from_user] =
      r.status === "accepted" ? "accepted" : r.status === "rejected" ? "rejected_by_them" : "pending";
  });
  outgoing.forEach((r) => {
    connectStatusMap[r.to_user] =
      r.status === "accepted" ? "accepted" : r.status === "rejected" ? "rejected_by_them" : "pending";
  });
  myConnections.forEach((p) => {
    connectStatusMap[p.id] = "accepted";
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: upsertProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myProfile"] });
      setEditingProfile(false);
      setSaveError(null);
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  const connectMutation = useMutation({
    mutationFn: sendRequest,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["outgoingRequests"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelRequest,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["outgoingRequests"] }),
  });

  const acceptMutation = useMutation({
    mutationFn: acceptRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incomingRequests"] });
      qc.invalidateQueries({ queryKey: ["myConnections"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectRequest,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["incomingRequests"] }),
  });

  async function handleRemoveConnection() {
    if (!drawerProfile) return;
    setIsRemoving(true);
    try {
      await removeConnection(drawerProfile.id);
      qc.invalidateQueries({ queryKey: ["myConnections"] });
      setDrawerProfile(null);
      setRemoveArmed(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRemoving(false);
    }
  }

  // ── Filtered lists ───────────────────────────────────────────────────────────
  const filteredDiscover = allProfiles.filter((p) => {
    if (connectStatusMap[p.id] === "rejected_by_them") return false;
    const q = discoverSearch.toLowerCase();
    return (
      !q ||
      p.display_name.toLowerCase().includes(q) ||
      (p.headline ?? "").toLowerCase().includes(q) ||
      p.skills.some((s) => s.toLowerCase().includes(q))
    );
  });

  const filteredNetwork = myConnections.filter((p) => {
    const q = networkSearch.toLowerCase();
    return (
      !q ||
      p.display_name.toLowerCase().includes(q) ||
      (p.headline ?? "").toLowerCase().includes(q) ||
      p.skills.some((s) => s.toLowerCase().includes(q))
    );
  });

  // ── External contact helpers ─────────────────────────────────────────────────
  function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!contactForm.name.trim() || !contactForm.role.trim() || !contactForm.company.trim()) {
      setContactFormError("Name, Role, and Company are required.");
      return;
    }
    const c: Contact = {
      id: Date.now().toString(),
      name: contactForm.name.trim(),
      role: contactForm.role.trim(),
      company: contactForm.company.trim(),
      status: contactForm.status,
      notes: contactForm.notes.trim(),
      email: contactForm.email.trim(),
      linkedinUrl: contactForm.linkedinUrl.trim(),
      lastContact: new Date().toISOString(),
    };
    const updated = [...contacts, c];
    setContacts(updated);
    saveContacts(updated);
    setShowAddContact(false);
    setContactForm(EMPTY_CONTACT_FORM);
    setContactFormError("");
  }

  function handleDeleteContact(id: string) {
    if (deleteConfirm === id) {
      const updated = contacts.filter((c) => c.id !== id);
      setContacts(updated);
      saveContacts(updated);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
    }
  }

  function handleCycleStatus(id: string) {
    const updated = contacts.map((c) =>
      c.id === id ? { ...c, status: STATUS_CYCLE[c.status] } : c
    );
    setContacts(updated);
    saveContacts(updated);
  }

  const pendingIncoming = incoming.length;

  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "profile", label: "My Profile" },
    { id: "discover", label: "Discover" },
    { id: "network", label: "My Network" },
    { id: "requests", label: "Requests", badge: pendingIncoming },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Header */}
      <section className="pt-xl pb-md">
        <h1
          className="text-headline-xl text-on-surface font-bold mb-sm"
          style={{ letterSpacing: "-0.02em" }}
        >
          Networking
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Connect with other Career Copilot users and grow your professional
          network.
        </p>
      </section>

      {/* Tab Navigation */}
      <div className="flex gap-lg border-b border-outline-variant/30">
        {tabs.map(({ id, label, badge }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`pb-sm text-label-md transition-all duration-200 whitespace-nowrap flex items-center gap-xs ${
              activeTab === id
                ? "text-primary font-bold border-b-2 border-primary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {label}
            {badge != null && badge > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-caption flex items-center justify-center font-bold">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── MY PROFILE TAB ───────────────────────────────────────────────────── */}
      {activeTab === "profile" && (
        <div className="max-w-2xl">
          {!myProfile || editingProfile ? (
            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
              {!myProfile && (
                <div className="mb-lg">
                  <h2 className="text-headline-md text-on-surface font-semibold mb-xs">
                    Set up your profile
                  </h2>
                  <p className="text-body-sm text-on-surface-variant">
                    Create your public profile so other Career Copilot users
                    can find and connect with you.
                  </p>
                </div>
              )}
              {myProfile && editingProfile && (
                <div className="flex items-center justify-between mb-lg">
                  <h2 className="text-headline-md text-on-surface font-semibold">
                    Edit Profile
                  </h2>
                  <button
                    onClick={() => {
                      setEditingProfile(false);
                      setSaveError(null);
                    }}
                    className="text-label-sm text-on-surface-variant hover:text-on-surface"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <ProfileForm
                initial={editingProfile ? myProfile : null}
                onSave={async (input: ProfileInput) => {
                  await saveMutation.mutateAsync(input);
                }}
                isSaving={saveMutation.isPending}
                error={saveError}
              />
            </div>
          ) : (
            /* Profile preview */
            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-lg">
              <div className="flex items-start justify-between">
                <h2 className="text-headline-md text-on-surface font-semibold">
                  Your Profile
                </h2>
                <button
                  onClick={() => setEditingProfile(true)}
                  className="text-label-sm text-primary hover:underline"
                >
                  Edit Profile
                </button>
              </div>

              <div className="flex items-center gap-md">
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-headline-md shrink-0 ${getAvatarColor(myProfile.id)}`}
                >
                  {getInitials(myProfile.display_name)}
                </div>
                <div>
                  <div className="flex items-center gap-sm flex-wrap">
                    <p className="text-headline-md text-on-surface font-bold">
                      {myProfile.display_name}
                    </p>
                    {myProfile.open_to_work && (
                      <span className="text-caption px-sm py-xs rounded-full bg-primary/10 text-primary font-semibold">
                        Open to Work
                      </span>
                    )}
                  </div>
                  {myProfile.headline && (
                    <p className="text-body-sm text-on-surface-variant">
                      {myProfile.headline}
                    </p>
                  )}
                  {myProfile.location && (
                    <p className="text-caption text-on-surface-variant">
                      {myProfile.location}
                    </p>
                  )}
                </div>
              </div>

              {myProfile.bio && (
                <p className="text-body-sm text-on-surface leading-relaxed">
                  {myProfile.bio}
                </p>
              )}

              {myProfile.skills.length > 0 && (
                <div className="flex flex-wrap gap-xs">
                  {myProfile.skills.map((s) => (
                    <span
                      key={s}
                      className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {myProfile.available_for.length > 0 && (
                <div className="flex gap-sm flex-wrap">
                  {myProfile.available_for.map((v) => (
                    <span
                      key={v}
                      className="px-md py-sm rounded-xl text-label-sm bg-secondary-container text-primary"
                    >
                      {v === "full-time"
                        ? "Full-time"
                        : v === "contract"
                        ? "Contract"
                        : "Mentoring"}
                    </span>
                  ))}
                </div>
              )}

              {(myProfile.linkedin_url || myProfile.github_url) && (
                <div className="flex gap-sm flex-wrap pt-sm border-t border-outline-variant/20">
                  {myProfile.linkedin_url && (
                    <a
                      href={myProfile.linkedin_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all"
                    >
                      LinkedIn ↗
                    </a>
                  )}
                  {myProfile.github_url && (
                    <a
                      href={myProfile.github_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all"
                    >
                      GitHub ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DISCOVER TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "discover" && (
        <div className="flex flex-col gap-lg">
          {!myProfile ? (
            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col items-center justify-center py-xxl gap-md text-center">
              <p className="text-body-md text-on-surface font-medium">
                Create your profile first
              </p>
              <p className="text-body-sm text-on-surface-variant">
                Set up your profile to start connecting with others.
              </p>
              <button
                onClick={() => setActiveTab("profile")}
                className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
              >
                Go to My Profile
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-md py-sm gap-sm">
                <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
                <input
                  value={discoverSearch}
                  onChange={(e) => setDiscoverSearch(e.target.value)}
                  placeholder="Search by name, headline, or skill…"
                  className="bg-transparent border-none outline-none text-body-sm text-on-surface w-full placeholder:text-on-surface-variant/60"
                />
              </div>

              {discoverError ? (
                <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 flex flex-col items-center gap-md py-xxl text-center">
                  <p className="text-body-md text-on-surface font-medium">
                    Failed to load profiles
                  </p>
                  <button
                    onClick={() => refetchDiscover()}
                    className="text-label-sm text-primary hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : filteredDiscover.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-xxl gap-md text-center">
                  <p className="text-body-md text-on-surface font-medium">
                    {discoverSearch
                      ? "No matching profiles"
                      : "No other users yet"}
                  </p>
                  <p className="text-body-sm text-on-surface-variant">
                    {discoverSearch
                      ? "Try a different search term."
                      : "Invite colleagues to join Career Copilot."}
                  </p>
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
                        onCancelRequest={() =>
                          outReq && cancelMutation.mutate(outReq.id)
                        }
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── MY NETWORK TAB ───────────────────────────────────────────────────── */}
      {activeTab === "network" && (
        <div className="flex flex-col gap-lg">
          <div className="flex items-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-md py-sm gap-sm">
            <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
            <input
              value={networkSearch}
              onChange={(e) => setNetworkSearch(e.target.value)}
              placeholder="Search connections…"
              className="bg-transparent border-none outline-none text-body-sm text-on-surface w-full placeholder:text-on-surface-variant/60"
            />
          </div>

          {filteredNetwork.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-xxl gap-md text-center">
              <p className="text-body-md text-on-surface font-medium">
                {networkSearch ? "No matching connections" : "No connections yet"}
              </p>
              <p className="text-body-sm text-on-surface-variant">
                {networkSearch
                  ? "Try a different search."
                  : "Head to Discover to find people."}
              </p>
              {!networkSearch && (
                <button
                  onClick={() => setActiveTab("discover")}
                  className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
                >
                  Go to Discover
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {filteredNetwork.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onClick={() => {
                    setDrawerProfile(p);
                    setRemoveArmed(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── REQUESTS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div className="flex flex-col gap-xl">
          {/* Incoming */}
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold mb-lg">
              Incoming Requests
            </h2>
            {incoming.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-center py-xl">
                <p className="text-body-sm text-on-surface-variant">
                  No pending requests
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-md">
                {incoming.map((req) => (
                  <div
                    key={req.id}
                    className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center gap-md"
                  >
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${getAvatarColor(req.profile.id)}`}
                    >
                      {getInitials(req.profile.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-label-md text-on-surface font-semibold truncate">
                        {req.profile.display_name}
                      </p>
                      {req.profile.headline && (
                        <p className="text-caption text-on-surface-variant truncate">
                          {req.profile.headline}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-sm shrink-0">
                      <button
                        onClick={() => acceptMutation.mutate(req.id)}
                        className="px-md py-sm rounded-xl text-label-sm text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-200"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => rejectMutation.mutate(req.id)}
                        className="px-md py-sm rounded-xl text-label-sm border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container transition-all"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outgoing */}
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold mb-lg">
              Outgoing Requests
            </h2>
            {outgoing.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-center py-xl">
                <p className="text-body-sm text-on-surface-variant">
                  No outgoing requests
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-md">
                {outgoing.map((req) => (
                  <div
                    key={req.id}
                    className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center gap-md"
                  >
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${getAvatarColor(req.profile.id)}`}
                    >
                      {getInitials(req.profile.display_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-label-md text-on-surface font-semibold truncate">
                        {req.profile.display_name}
                      </p>
                      {req.profile.headline && (
                        <p className="text-caption text-on-surface-variant truncate">
                          {req.profile.headline}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => cancelMutation.mutate(req.id)}
                      className="px-md py-sm rounded-xl text-label-sm border border-outline-variant/40 text-on-surface-variant hover:border-error/40 hover:text-error transition-all shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CONNECTION DRAWER ─────────────────────────────────────────────────── */}
      {drawerProfile && (
        <ConnectionDrawer
          profile={drawerProfile}
          onClose={() => {
            setDrawerProfile(null);
            setRemoveArmed(false);
          }}
          onRemove={handleRemoveConnection}
          isRemoving={isRemoving}
          removeArmed={removeArmed}
          onArmRemove={() => setRemoveArmed(true)}
        />
      )}

      {/* ── EXTERNAL CONTACTS (collapsible) ──────────────────────────────────── */}
      <div className="border-t border-outline-variant/20 pt-lg">
        <button
          onClick={() => setContactsOpen((o) => !o)}
          className="flex items-center gap-sm text-label-md text-on-surface-variant hover:text-on-surface transition-colors mb-md"
        >
          <CaretDown
            size={18}
            className={`transition-transform duration-200 ${contactsOpen ? "rotate-180" : ""}`}
          />
          External Contacts ({contacts.length})
        </button>

        {contactsOpen && (
          <div className="flex flex-col gap-lg">
            <button
              onClick={() => setShowAddContact(true)}
              className="flex items-center gap-sm self-start px-lg py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              <Plus size={18} /> Add External Contact
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {contacts.map((contact, i) => {
                const { label, color } = STATUS_CONFIG[contact.status];
                return (
                  <div
                    key={contact.id}
                    className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col gap-md"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-md">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${LEGACY_AVATAR_COLORS[i % LEGACY_AVATAR_COLORS.length]}`}
                        >
                          {getInitials(contact.name)}
                        </div>
                        <div>
                          <p className="text-label-md text-on-surface font-semibold">
                            {contact.name}
                          </p>
                          <p className="text-caption text-on-surface-variant">
                            {contact.role} @ {contact.company}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleCycleStatus(contact.id)}
                        className={`text-caption px-sm py-xs rounded-full font-semibold shrink-0 cursor-pointer hover:opacity-80 transition-opacity ${color}`}
                      >
                        {label}
                      </button>
                    </div>

                    <p className="text-body-sm text-on-surface-variant flex-1">
                      {contact.notes || "No notes yet."}
                    </p>

                    <div className="flex items-center justify-between pt-sm border-t border-outline-variant/20">
                      <div className="flex items-center gap-xs text-caption text-on-surface-variant">
                        <Clock size={12} />
                        {formatDate(contact.lastContact)}
                      </div>
                      <div className="flex gap-sm">
                        <button
                          onClick={() =>
                            contact.linkedinUrl
                              ? window.open(contact.linkedinUrl, "_blank")
                              : undefined
                          }
                          className={`w-8 h-8 rounded-full bg-surface-container flex items-center justify-center transition-colors ${contact.linkedinUrl ? "text-on-surface-variant hover:text-primary cursor-pointer" : "text-outline-variant cursor-not-allowed opacity-50"}`}
                        >
                          <LinkedinLogo size={16} />
                        </button>
                        <button
                          onClick={() =>
                            contact.email
                              ? window.open(`mailto:${contact.email}`)
                              : undefined
                          }
                          className={`w-8 h-8 rounded-full bg-surface-container flex items-center justify-center transition-colors ${contact.email ? "text-on-surface-variant hover:text-primary cursor-pointer" : "text-outline-variant cursor-not-allowed opacity-50"}`}
                        >
                          <EnvelopeSimple size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteContact(contact.id)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${deleteConfirm === contact.id ? "bg-error text-on-primary" : "bg-surface-container hover:bg-error-container/50 text-on-surface-variant hover:text-error"}`}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </div>
                    {deleteConfirm === contact.id && (
                      <p className="text-caption text-error text-center">
                        Click trash again to confirm
                      </p>
                    )}
                  </div>
                );
              })}
              {contacts.length === 0 && (
                <div className="col-span-full text-center py-xl">
                  <p className="text-body-sm text-on-surface-variant">
                    No external contacts yet.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add External Contact Modal */}
      {showAddContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-gutter bg-on-surface/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddContact(false);
              setContactFormError("");
            }
          }}
        >
          <div className="bg-surface-container-lowest rounded-2xl p-xl border border-outline-variant/20 shadow-lg w-full max-w-[480px] flex flex-col gap-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-headline-md text-on-surface font-semibold">
                Add External Contact
              </h2>
              <button
                onClick={() => {
                  setShowAddContact(false);
                  setContactFormError("");
                }}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddContact} className="flex flex-col gap-md">
              {contactFormError && (
                <p className="text-body-sm text-error">{contactFormError}</p>
              )}
              {(
                [
                  { label: "Name *", key: "name", placeholder: "Jane Smith" },
                  { label: "Role *", key: "role", placeholder: "Senior Engineer" },
                  { label: "Company *", key: "company", placeholder: "Acme Corp" },
                  { label: "Email", key: "email", placeholder: "jane@example.com" },
                  { label: "LinkedIn URL", key: "linkedinUrl", placeholder: "https://linkedin.com/in/jane" },
                ] as const
              ).map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">
                    {label}
                  </label>
                  <input
                    value={contactForm[key]}
                    onChange={(e) =>
                      setContactForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                  />
                </div>
              ))}
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">
                  Notes
                </label>
                <textarea
                  value={contactForm.notes}
                  onChange={(e) =>
                    setContactForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={3}
                  placeholder="How you met, what you discussed…"
                  className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm outline-none focus:ring-2 focus:ring-primary resize-none transition-all"
                />
              </div>
              <div className="flex gap-md pt-sm">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddContact(false);
                    setContactFormError("");
                  }}
                  className="flex-1 py-md rounded-xl border border-outline-variant/30 text-label-md text-on-surface-variant hover:bg-surface-container transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
                >
                  Add Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
