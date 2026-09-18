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
  CaretDoubleRight,
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
      className={`hidden md:flex flex-col gap-sm ${collapsed ? "px-xs py-md" : "p-md"} bg-surface-container-lowest/80 backdrop-blur-xl h-screen w-[var(--sidebar-w)] left-0 fixed border-r border-outline-variant/20 shadow-sm z-50 transition-[width] duration-300`}
    >
      {/* Collapse flap — an edge handle, the conventional place to find this.
          It lived in the footer under eight identically-styled nav links and
          was invisible there. Carries no text, so the 72px rail never
          constrains it.

          Anchored near the top beside the logo rather than centred: centred,
          it sat mid-content on every page and overlapped whatever <main>
          rendered at that height. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute top-lg right-0 translate-x-full z-10 flex items-center justify-center w-5 h-10 rounded-r-lg border border-l-0 border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-xl text-on-surface-variant shadow-sm hover:w-6 hover:text-primary hover:border-primary/40 transition-all duration-200"
      >
        {collapsed ? <CaretDoubleRight size={14} weight="bold" /> : <CaretDoubleLeft size={14} weight="bold" />}
      </button>

      {/* Logo — the 154px wordmark cannot fit a 72px rail, so the rail wears
          the square mark instead. Same alt text either way. */}
      <Link
        href="/dashboard"
        className={`shrink-0 flex flex-col gap-xs mb-md ${collapsed ? "items-center px-0 py-md" : "px-md py-lg"}`}
      >
        {collapsed ? (
          <Image src="/brand/logo-mark-light.png" alt="KripaX" width={32} height={32} priority />
        ) : (
          <>
            <Image src="/brand/logo-wordmark.png" alt="KripaX" width={154} height={34} priority />
            <span className="text-caption text-secondary uppercase tracking-wider">
              Build | Tailor | Score | Prepare
            </span>
          </>
        )}
      </Link>

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
              className={`flex items-center gap-md py-md rounded-xl text-label-md transition-all duration-300 ${
                collapsed ? "justify-center px-0" : "px-md"
              } ${
                active
                  ? "bg-secondary-container text-on-secondary-container font-bold shadow-sm hover:shadow-md hover:scale-[0.98]"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
              }`}
            >
              <Icon size={24} weight={active ? "fill" : "regular"} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — collapse control, then credit balance; sign-out lives on /account */}
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
