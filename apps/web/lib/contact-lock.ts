"use client";
import type { ContactInfo } from "@/lib/career-profile-client";
import { tidySocialLink } from "@/lib/social-links";

/**
 * Contact details belong to the user, not to whichever résumé they upload.
 *
 * They are collected at sign-up and edited by hand on the profile. Reading a
 * résumé used to replace them with whatever the PDF said, so an old résumé
 * put back an old phone number or address. Now a parsed résumé only fills
 * a field that is still empty, and never touches the email.
 *
 * The email is the account's sign-in email, always: it is what the account
 * is known by, so no form and no résumé can change it. The name is fixed
 * too, once saved: it is set when the profile is set up (onboarding). The
 * database holds both (migration 058) whatever a save sends.
 */
const FILLABLE = ["name", "phone", "location", "linkedin", "github", "website"] as const satisfies readonly (keyof ContactInfo)[];

export function mergeParsedContact(
  current: Partial<ContactInfo>,
  parsed: Partial<ContactInfo> | undefined,
  accountEmail: string | null,
): ContactInfo {
  const out: ContactInfo = { name: "", email: "" };
  for (const key of FILLABLE) {
    const mine = (current[key] ?? "").toString().trim();
    const theirs = (parsed?.[key] ?? "").toString().trim();
    const value = mine || theirs;
    if (value || key === "name") (out as unknown as Record<string, string>)[key] = value;
  }
  out.email = lockedEmail(current.email, accountEmail);
  return out;
}

/** The email to show and save: the sign-in email when known, else what the
 * profile already holds. Never anything a résumé or form typed in. */
export function lockedEmail(current: string | undefined, accountEmail: string | null): string {
  return (accountEmail || current || "").trim();
}

/** The name to show and save: the one the profile was saved with, once it
 * has one; until then (a profile made before names were asked for), what
 * the form holds. */
export function lockedName(current: string | undefined, savedName: string | null | undefined): string {
  return (savedName ?? "").trim() || (current ?? "").trim();
}

/** How often the phone may change: at most once in this many days. The
 * database enforces it (apps/api migration 059, PHONE_RULE_DAYS — a test
 * keeps the two equal). */
export const PHONE_CHANGE_DAYS = 30;

/** The date the phone can change again, or null when it can change now —
 * PHONE_CHANGE_DAYS after its last change. A profile's first phone starts
 * no clock (changedAt stays null); removing one does. */
export function phoneChangeableFrom(changedAt: string | null | undefined, now: Date = new Date()): Date | null {
  if (!changedAt) return null;
  const at = new Date(changedAt);
  if (Number.isNaN(at.getTime())) return null;
  const until = new Date(at.getTime() + PHONE_CHANGE_DAYS * 24 * 60 * 60 * 1000);
  return until > now ? until : null;
}

export type FillableContactField = (typeof FILLABLE)[number];

/** Details an upload may offer in place of the profile's: not the name or
 * the email, which are fixed. */
const OFFERED = FILLABLE.filter((f) => f !== "name");
export type OfferedContactField = Exclude<FillableContactField, "name">;

/** A contact detail the uploaded résumé prints differently from the profile. */
export interface ContactDifference {
  field: OfferedContactField;
  value: string;
}

/** What one detail is, ignoring how it's written: a phone's digits, a
 * profile link in its standard form, anything else without case or spacing. */
function sameDetail(field: OfferedContactField, a: string, b: string): boolean {
  if (field === "phone") return a.replace(/\D/g, "").endsWith(b.replace(/\D/g, "").slice(-10));
  if (field === "linkedin" || field === "github") {
    return (tidySocialLink(field, a) ?? a).toLowerCase() === (tidySocialLink(field, b) ?? b).toLowerCase();
  }
  const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[\s/]+$/, "").replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

/**
 * The details a parsed résumé prints differently from the ones the profile
 * already has — offered to the person, never applied for them (merge only
 * fills empty fields). The name and email are never among them: both are
 * fixed.
 */
export function contactDifferences(
  current: Partial<ContactInfo>,
  parsed: Partial<ContactInfo> | undefined,
): ContactDifference[] {
  const out: ContactDifference[] = [];
  for (const field of OFFERED as OfferedContactField[]) {
    const mine = (current[field] ?? "").toString().trim();
    const theirs = (parsed?.[field] ?? "").toString().trim();
    if (mine && theirs && !sameDetail(field, mine, theirs)) out.push({ field, value: theirs });
  }
  return out;
}

/**
 * The name, email and phone every résumé carries: the account's
 * (apps/api services/account_contact). A detail the account has no value
 * for is undefined, and the résumé keeps its own — a profile made before
 * names were asked for, or one with no phone.
 */
export function accountContact(
  profileContact: Partial<ContactInfo> | undefined | null,
  accountEmail: string | null,
): { name?: string; email?: string; phone?: string } {
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    name: clean(profileContact?.name),
    email: clean(accountEmail) ?? clean(profileContact?.email),
    phone: clean(profileContact?.phone),
  };
}
