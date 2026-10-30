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
 * is known by, so no form and no résumé can change it.
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

export type FillableContactField = (typeof FILLABLE)[number];

/** A contact detail the uploaded résumé prints differently from the profile. */
export interface ContactDifference {
  field: FillableContactField;
  value: string;
}

/** What one detail is, ignoring how it's written: a phone's digits, a
 * profile link in its standard form, anything else without case or spacing. */
function sameDetail(field: FillableContactField, a: string, b: string): boolean {
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
 * fills empty fields). The email is never among them: it is the sign-in
 * email, always.
 */
export function contactDifferences(
  current: Partial<ContactInfo>,
  parsed: Partial<ContactInfo> | undefined,
): ContactDifference[] {
  const out: ContactDifference[] = [];
  for (const field of FILLABLE) {
    const mine = (current[field] ?? "").toString().trim();
    const theirs = (parsed?.[field] ?? "").toString().trim();
    if (mine && theirs && !sameDetail(field, mine, theirs)) out.push({ field, value: theirs });
  }
  return out;
}
