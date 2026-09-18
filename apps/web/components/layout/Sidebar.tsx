"use client";
import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  SquaresFour,
  FileDashed,
  FileText,
  ChartLineUp,
  MicrophoneStage,
  IdentificationCard,
  EnvelopeSimple,
  CreditCard,
  CaretDoubleLeft,
} from "@phosphor-icons/react";
import { CreditMeter } from "./CreditMeter";
import { useSidebarStore } from "@/stores/sidebar-store";

// Phase 1 nav — Career Path (/career-path) and Networking (/networking) are
// intentionally excluded. Their pages and backend code are intact in git
// and will be re-enabled in Phase 2.
const NAV = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard" },
  { href: "/profile", icon: IdentificationCard, label: "My Profile" },
  { href: "/jd", icon: FileDashed, label: "JD Analyzer" },
  { href: "/studio", icon: FileText, label: "Resume Builder" },
  { href: "/cover-letters", icon: EnvelopeSimple, label: "Cover Letter" },
  { href: "/interview", icon: MicrophoneStage, label: "Interview Center" },
  { href: "/analytics", icon: ChartLineUp, label: "Analytics" },
  { href: "/account", icon: CreditCard, label: "Account" },
];

export function Sidebar() {
  const pathname = usePathname();
  const override = useSidebarStore((s) => s.override);
  const toggle = useSidebarStore((s) => s.toggle);
  const hydrate = useSidebarStore((s) => s.hydrate);

  // The inline script in app/layout.tsx already applied the stored choice to
  // the DOM before first paint; this only syncs React's copy of it.
  useEffect(() => hydrate(), [hydrate]);

  const collapsed = override === "collapsed";

  // The override lives on <html>, not on this element: --sidebar-w has to
  // resolve for <main> too (see (app)/layout.tsx), and <main> is a sibling.
  // With no override the attribute is absent and the stylesheet's breakpoint
  // rule applies, so the right rail paints before React hydrates.
  useEffect(() => {
    const root = document.documentElement;
    if (override === null) delete root.dataset.sidebar;
    else root.dataset.sidebar = override;
  }, [override]);

  return (
    <aside
      className={`hidden md:flex flex-col gap-sm ${collapsed ? "px-xs py-md" : "p-md"} bg-surface-container-lowest/80 backdrop-blur-xl h-screen w-[var(--sidebar-w)] left-0 fixed border-r border-outline-variant/20 shadow-sm z-50 transition-[width,padding] duration-300`}
    >

      {/* Logo — the 154px wordmark cannot fit a 72px rail, so the rail wears
          the square mark instead. Same alt text either way. */}
      <Link
        href="/dashboard"
        className={`shrink-0 flex flex-col gap-xs mb-md overflow-hidden px-md transition-[padding] duration-300 ${
          collapsed ? "py-md" : "py-lg"
        }`}
      >
        {/* Both marks stay mounted and cross-fade. Swapping one <Image>'s
            src meant fetching the other file mid-animation — a blank flash —
            and its intrinsic size changed instantly, jerking the row. The box
            is a fixed 34px tall so neither state reflows the column; the
            wordmark keeps the alt text, the square mark is decorative. */}
        <span className={`relative shrink-0 h-[34px] ${collapsed ? "w-8" : "w-[154px]"} transition-[width] duration-300`}>
          <Image
            src="/brand/logo-wordmark.png"
            alt="KripaX"
            width={154}
            height={34}
            priority
            className={`absolute left-0 top-0 max-w-none transition-opacity duration-300 ${
              collapsed ? "opacity-0" : "opacity-100"
            }`}
          />
          <Image
            src="/brand/logo-mark-light.png"
            alt=""
            aria-hidden
            width={32}
            height={32}
            priority
            className={`absolute left-0 top-px transition-opacity duration-300 ${
              collapsed ? "opacity-100" : "opacity-0"
            }`}
          />
        </span>
        <span
          className={`text-caption text-secondary uppercase tracking-wider whitespace-nowrap transition-[max-height,opacity] duration-300 ${
            collapsed ? "max-h-0 opacity-0" : "max-h-8 opacity-100"
          }`}
        >
          Build | Tailor | Score | Prepare
        </span>
      </Link>

      {/* Collapse flap — an edge handle, the conventional place to find one.
          It began as a footer row beneath eight identically-styled nav links
          and was invisible there.

          Level with the top bar's search pill: TopNav is h-14 (56px) so the
          pill centres 28px down, and the aside starts at the viewport top,
          so top-sm puts this 40px flap's centre on the same line.

          It hangs on the aside rather than inside the nav because the nav
          scrolls, and overflow-y:auto computes overflow-x to auto too, which
          would clip it. The aside is position:fixed (already a containing
          block) and sets no overflow. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute top-sm right-0 translate-x-full z-10 flex items-center justify-center w-5 h-10 rounded-r-lg border border-l-0 border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-xl text-on-surface-variant shadow-sm hover:text-primary hover:border-primary/40 transition-colors duration-200"
      >
        <CaretDoubleLeft
          size={14}
          weight="bold"
          className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
        />
      </button>

      {/* Nav Items */}
      <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-sm">
        {NAV.map(({ href, icon: Icon, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={label}
                href={href}
                data-tour={href}
                // The icon is the only visible affordance on the rail, so the
                // accessible name and the hover tooltip both have to carry the
                // label or the collapsed sidebar is unusable.
                aria-label={label}
                title={collapsed ? label : undefined}
                className={`flex items-center py-md rounded-xl text-label-md overflow-hidden whitespace-nowrap transition-[padding,gap,background-color,color] duration-300 ${
                  collapsed ? "gap-0 px-5" : "gap-md px-md"
                } ${
                  active
                    ? "bg-secondary-container text-on-secondary-container font-bold shadow-sm hover:shadow-md"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
                }`}
              >
                <Icon size={24} weight={active ? "fill" : "regular"} className="shrink-0" />
                {/* Mounted in both states: unmounting made the text vanish
                    instantly while the sidebar took 300ms to narrow. */}
                <span
                  className={`overflow-hidden transition-[max-width,opacity] duration-300 ${
                    collapsed ? "max-w-0 opacity-0" : "max-w-[180px] opacity-100"
                  }`}
                >
                  {label}
                </span>
              </Link>
            );
        })}
      </nav>

      {/* Bottom — credit balance; the collapse flap moved to the nav edge,
          and sign-out lives on /account */}
      <div className="shrink-0 mt-auto pt-sm pb-md border-t border-outline-variant/20">
        <CreditMeter variant={collapsed ? "rail" : "full"} />
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}
