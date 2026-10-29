"use client";
import type { ContactInfo } from "@/lib/career-profile-client";

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
const FILLABLE: (keyof ContactInfo)[] = ["name", "phone", "location", "linkedin", "github", "website"];

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
