import {
  ChartLineUp,
  CreditCard,
  EnvelopeSimple,
  FileDashed,
  FileText,
  IdentificationCard,
  MicrophoneStage,
  Path,
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
// Networking (/networking) is intentionally left out for now — its page and
// backend code are intact and come back later. Career Path joined on
// 2026-10-11 (on phones it sits under "More").
export const APP_NAV: NavItem[] = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard" },
  { href: "/profile", icon: IdentificationCard, label: "My Profile", short: "Profile" },
  { href: "/jd", icon: FileDashed, label: "JD Analyzer", short: "JD" },
  { href: "/studio", icon: FileText, label: "Resume Builder", short: "Resume" },
  { href: "/cover-letters", icon: EnvelopeSimple, label: "Cover Letter" },
  { href: "/interview", icon: MicrophoneStage, label: "Interview Center", short: "Interview" },
  { href: "/career-path", icon: Path, label: "Career Path" },
  { href: "/analytics", icon: ChartLineUp, label: "Analytics" },
  { href: "/account", icon: CreditCard, label: "Account" },
];

/** The phone's tab bar, in thumb order; everything else sits under "More". */
export const PHONE_TABS = ["/dashboard", "/jd", "/studio", "/interview"];

export function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
