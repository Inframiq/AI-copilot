/**
 * The dashboard's opening line.
 *
 * A new account is welcomed; a returning one is welcomed back, and past that
 * the line follows the time of day, so the same screen does not say the
 * same sentence on every visit. Which variant is shown is chosen by the
 * caller's `pick` (0..1), so rendering stays pure and testable.
 */

export interface Greeting {
  title: string;
  subtitle: string;
}

type Line = (name: string) => string;

// `name` is always non-empty inside these: nameless greetings are handled
// separately so no line ever reads "Good morning, ".
const NEW: Line[] = [
  (n) => `Welcome, ${n}`,
  (n) => `Welcome aboard, ${n}`,
  (n) => `Glad you're here, ${n}`,
];

const RETURNING: Record<DayPart, Line[]> = {
  morning: [
    (n) => `Good morning, ${n}`,
    (n) => `Morning, ${n}`,
    (n) => `Welcome back, ${n}`,
    (n) => `Early start, ${n}`,
  ],
  afternoon: [
    (n) => `Good afternoon, ${n}`,
    (n) => `Welcome back, ${n}`,
    (n) => `Afternoon, ${n}`,
  ],
  evening: [
    (n) => `Good evening, ${n}`,
    (n) => `Welcome back, ${n}`,
    (n) => `Evening, ${n}`,
  ],
  night: [
    (n) => `Hello, night owl ${n}`,
    (n) => `Burning the midnight oil, ${n}?`,
    (n) => `Welcome back, ${n}`,
    (n) => `Still up, ${n}?`,
  ],
};

const NAMELESS: Record<"new" | DayPart, string> = {
  new: "Welcome",
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Hello, night owl",
};

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** First word of the name, trimmed: "Tanishq Kumar" greets "Tanishq". */
export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Whether this is the account's first session: it has signed in exactly once
 * (at signup), so creation and last sign-in are moments apart. Stays true
 * across reloads of that session, and turns false on the next sign-in.
 */
export function isNewAccount(
  createdAt: string | null | undefined,
  lastSignInAt: string | null | undefined,
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  // Never signed in again, or signed in only while confirming the signup.
  if (!lastSignInAt) return true;
  const last = Date.parse(lastSignInAt);
  return !Number.isNaN(last) && last - created < 10 * 60 * 1000;
}

export function greeting({
  name,
  isNew,
  hour,
  pick,
}: {
  name: string;
  isNew: boolean;
  hour: number;
  /** In [0, 1): which variant to show. */
  pick: number;
}): Greeting {
  const part = dayPart(hour);
  const lines = isNew ? NEW : RETURNING[part];
  const index = Math.min(lines.length - 1, Math.floor(Math.max(0, pick) * lines.length));
  const title = name ? lines[index](name) : NAMELESS[isNew ? "new" : part];
  const subtitle = isNew
    ? "Let's get your first tailored résumé ready. Start wherever you like below."
    : "Here's a snapshot of where things stand.";
  return { title, subtitle };
}
