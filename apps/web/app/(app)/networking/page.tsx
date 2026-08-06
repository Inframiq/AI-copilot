"use client";
import { useState } from "react";
import {
  Users,
  LinkedinLogo,
  EnvelopeSimple,
  Plus,
  MagnifyingGlass,
  Clock,
  CheckCircle,
  Circle,
  Trash,
  X,
} from "@phosphor-icons/react";

interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  status: "connected" | "following-up" | "new";
  lastContact: string; // ISO string
  notes: string;
  email: string;
  linkedinUrl: string;
}

const STORAGE_KEY = "career-copilot-contacts";
const SEED_CONTACTS: Contact[] = [
  { id: "1", name: "Sarah Chen", role: "Engineering Manager", company: "Google", status: "connected", lastContact: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), notes: "Met at SF Tech Meetup. Offered to refer.", email: "", linkedinUrl: "" },
  { id: "2", name: "Marcus Johnson", role: "Senior SWE", company: "Stripe", status: "following-up", lastContact: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), notes: "Coffee chat scheduled.", email: "", linkedinUrl: "" },
  { id: "3", name: "Priya Patel", role: "Staff Engineer", company: "Airbnb", status: "new", lastContact: new Date().toISOString(), notes: "Connected after her talk on distributed systems.", email: "", linkedinUrl: "" },
];

function loadContacts(): Contact[] {
  if (typeof window === "undefined") return SEED_CONTACTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_CONTACTS));
      return SEED_CONTACTS;
    }
    return JSON.parse(raw);
  } catch { return SEED_CONTACTS; }
}

function saveContacts(contacts: Contact[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

function formatDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  return `${diffMonths} months ago`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const STATUS_CONFIG: Record<Contact["status"], { label: string; color: string; icon: typeof CheckCircle }> = {
  connected: { label: "Connected", color: "text-success-accent bg-primary/10", icon: CheckCircle },
  "following-up": { label: "Follow Up", color: "text-secondary bg-surface-container-high", icon: Clock },
  new: { label: "New", color: "text-primary bg-secondary-container", icon: Circle },
};

const AVATAR_COLORS = [
  "bg-primary text-on-primary",
  "bg-secondary-container text-primary",
  "bg-surface-container-high text-on-surface",
  "bg-surface-variant text-primary",
  "bg-primary-container text-on-primary",
];

const STATUS_CYCLE: Record<Contact["status"], Contact["status"]> = {
  new: "following-up",
  "following-up": "connected",
  connected: "new",
};

const EMPTY_FORM = {
  name: "",
  role: "",
  company: "",
  status: "new" as Contact["status"],
  notes: "",
  email: "",
  linkedinUrl: "",
};

export default function NetworkingPage() {
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | Contact["status"]>("all");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = contacts.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.role.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || c.status === filter;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: contacts.length,
    connected: contacts.filter((c) => c.status === "connected").length,
    followUp: contacts.filter((c) => c.status === "following-up").length,
    newCount: contacts.filter((c) => c.status === "new").length,
  };

  function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.role.trim() || !form.company.trim()) {
      setFormError("Name, Role, and Company are required.");
      return;
    }
    const newContact: Contact = {
      id: Date.now().toString(),
      name: form.name.trim(),
      role: form.role.trim(),
      company: form.company.trim(),
      status: form.status,
      notes: form.notes.trim(),
      email: form.email.trim(),
      linkedinUrl: form.linkedinUrl.trim(),
      lastContact: new Date().toISOString(),
    };
    const updated = [...contacts, newContact];
    setContacts(updated);
    saveContacts(updated);
    setShowModal(false);
    setForm(EMPTY_FORM);
    setFormError("");
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

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Header */}
      <section className="pt-xl pb-md flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold mb-sm" style={{ letterSpacing: "-0.02em" }}>
            Networking
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            Track your professional connections and outreach efforts.
          </p>
        </div>
        <button
          onClick={() => { setShowModal(true); setForm(EMPTY_FORM); setFormError(""); }}
          className="flex items-center gap-sm px-lg py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 self-start md:self-auto"
        >
          <Plus size={18} />
          Add Contact
        </button>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-gutter">
        {[
          { label: "Total Contacts", value: stats.total, color: "text-on-surface" },
          { label: "Connected", value: stats.connected, color: "text-success-accent" },
          { label: "Follow Up", value: stats.followUp, color: "text-secondary" },
          { label: "New This Week", value: stats.newCount, color: "text-primary" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-xs">
            <span className="text-label-md text-on-surface-variant">{label}</span>
            <span className={`text-headline-xl font-bold ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col md:flex-row gap-md">
        <div className="flex items-center bg-surface-container-lowest rounded-xl border border-outline-variant/30 px-md py-sm gap-sm flex-1">
          <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, role, or company..."
            className="bg-transparent border-none outline-none text-body-sm text-on-surface w-full placeholder:text-on-surface-variant/60"
          />
        </div>
        <div className="flex gap-sm flex-wrap">
          {(["all", "connected", "following-up", "new"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-md py-sm rounded-xl text-label-sm transition-all ${
                filter === f
                  ? "bg-secondary-container text-primary font-bold"
                  : "bg-surface-container-lowest border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container"
              }`}
            >
              {f === "all" ? "All" : f === "following-up" ? "Follow Up" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Contact Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
        {filtered.map((contact, i) => {
          const { label, color } = STATUS_CONFIG[contact.status];
          return (
            <div
              key={contact.id}
              className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col gap-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-md">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                    {getInitials(contact.name)}
                  </div>
                  <div>
                    <p className="text-label-md text-on-surface font-semibold">{contact.name}</p>
                    <p className="text-caption text-on-surface-variant">{contact.role} @ {contact.company}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleCycleStatus(contact.id)}
                  className={`text-caption px-sm py-xs rounded-full font-semibold shrink-0 cursor-pointer hover:opacity-80 transition-opacity ${color}`}
                  title="Click to cycle status"
                >
                  {label}
                </button>
              </div>

              <p className="text-body-sm text-on-surface-variant flex-1">{contact.notes || "No notes yet."}</p>

              <div className="flex items-center justify-between pt-sm border-t border-outline-variant/20">
                <div className="flex items-center gap-xs text-caption text-on-surface-variant">
                  <Clock size={12} />
                  {formatDate(contact.lastContact)}
                </div>
                <div className="flex gap-sm">
                  <button
                    onClick={() => contact.linkedinUrl ? window.open(contact.linkedinUrl, "_blank") : undefined}
                    className={`w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center transition-colors ${contact.linkedinUrl ? "text-on-surface-variant hover:text-primary cursor-pointer" : "text-outline-variant cursor-not-allowed opacity-50"}`}
                    title={contact.linkedinUrl ? "Open LinkedIn" : "No LinkedIn URL"}
                  >
                    <LinkedinLogo size={16} />
                  </button>
                  <button
                    onClick={() => contact.email ? window.open(`mailto:${contact.email}`) : undefined}
                    className={`w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center transition-colors ${contact.email ? "text-on-surface-variant hover:text-primary cursor-pointer" : "text-outline-variant cursor-not-allowed opacity-50"}`}
                    title={contact.email ? `Email ${contact.name}` : "No email"}
                  >
                    <EnvelopeSimple size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteContact(contact.id)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${deleteConfirm === contact.id ? "bg-error text-on-primary" : "bg-surface-container hover:bg-error-container/50 text-on-surface-variant hover:text-error"}`}
                    title={deleteConfirm === contact.id ? "Click again to confirm delete" : "Delete contact"}
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </div>
              {deleteConfirm === contact.id && (
                <p className="text-caption text-error text-center">Click trash again to confirm deletion</p>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-xxl gap-md text-center">
            <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center">
              <Users size={32} className="text-on-surface-variant" />
            </div>
            <div>
              <p className="text-body-md text-on-surface font-medium mb-xs">No contacts found</p>
              <p className="text-body-sm text-on-surface-variant">Try adjusting your search or filter.</p>
            </div>
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-gutter bg-on-surface/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowModal(false); setForm(EMPTY_FORM); setFormError(""); } }}
        >
          <div className="bg-surface-container-lowest rounded-2xl p-xl border border-outline-variant/20 shadow-lg shadow-on-surface/10 w-full max-w-[480px] flex flex-col gap-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-headline-md text-on-surface font-semibold">Add Contact</h2>
              <button
                onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setFormError(""); }}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddContact} className="flex flex-col gap-md">
              {formError && (
                <p className="text-body-sm text-error">{formError}</p>
              )}

              {[
                { label: "Name *", key: "name", placeholder: "Jane Smith" },
                { label: "Role *", key: "role", placeholder: "Senior Engineer" },
                { label: "Company *", key: "company", placeholder: "Acme Corp" },
                { label: "Email (optional)", key: "email", placeholder: "jane@example.com" },
                { label: "LinkedIn URL (optional)", key: "linkedinUrl", placeholder: "https://linkedin.com/in/jane" },
              ].map(({ label, key, placeholder }) => (
                <div key={key} className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">{label}</label>
                  <input
                    value={form[key as keyof typeof form]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50"
                  />
                </div>
              ))}

              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Contact["status"] }))}
                  className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="new">New</option>
                  <option value="following-up">Following Up</option>
                  <option value="connected">Connected</option>
                </select>
              </div>

              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="How you met, what you discussed..."
                  rows={3}
                  className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 resize-none"
                />
              </div>

              <div className="flex gap-md pt-sm">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setFormError(""); }}
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
