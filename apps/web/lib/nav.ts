import {
  ChartLineUp,
  CreditCard,
  EnvelopeSimple,
  FileDashed,
  FileText,
  IdentificationCard,
  MicrophoneStage,
  SquaresFour,
  type Icon,
} from "@phosphor-icons/react";

export interface NavItem {
  href: string;
  icon: Icon;
  label: string;
  /** The phone tab bar's shorter name, where the full one won't fit. */
  short?: string;
}

// Every page the app's navigation offers — the laptop sidebar lists them all,
// the phone shows four as tabs and the rest under "More". One list, so a page
// added for one is never missing from the other.
//
// Phase 1 nav — Career Path (/career-path) and Networking (/networking) are
// intentionally excluded. Their pages and backend code are intact in git and
// will be re-enabled in Phase 2.
export const APP_NAV: NavItem[] = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard" },
  { href: "/profile", icon: IdentificationCard, label: "My Profile", short: "Profile" },
  { href: "/jd", icon: FileDashed, label: "JD Analyzer", short: "JD" },
  { href: "/studio", icon: FileText, label: "Resume Builder", short: "Resume" },
  { href: "/cover-letters", icon: EnvelopeSimple, label: "Cover Letter" },
  { href: "/interview", icon: MicrophoneStage, label: "Interview Center", short: "Interview" },
  { href: "/analytics", icon: ChartLineUp, label: "Analytics" },
  { href: "/account", icon: CreditCard, label: "Account" },
];

/** The phone's tab bar, in thumb order; everything else sits under "More". */
export const PHONE_TABS = ["/dashboard", "/jd", "/studio", "/interview"];

export function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
