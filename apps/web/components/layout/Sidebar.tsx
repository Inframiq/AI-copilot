"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  SquaresFour,
  FileDashed,
  FileText,
  RocketLaunch,
  ChartLineUp,
  MicrophoneStage,
  IdentificationCard,
  EnvelopeSimple,
  CreditCard,
} from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";
import { CreditMeter } from "./CreditMeter";

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
  const router = useRouter();
  const supabase = createBrowserClient();
  const queryClient = useQueryClient();

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out errors — treat as signed out
    }
    // Drop any cached query results (resumes, dashboard stats, etc.) so the
    // next person to sign in on this browser/tab doesn't see this user's
    // data before their own fetches land.
    queryClient.clear();
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside className="hidden md:flex flex-col p-md gap-sm bg-surface-container-lowest/80 backdrop-blur-xl h-screen w-[280px] left-0 fixed border-r border-outline-variant/20 shadow-sm z-50">
      {/* Logo */}
      <div className="flex items-center gap-md px-md py-lg mb-md">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
          <RocketLaunch size={20} weight="fill" className="text-on-primary" />
        </div>
        <div className="flex flex-col">
          <span className="text-headline-md font-black text-primary">Career Copilot</span>
          <span className="text-caption text-secondary uppercase tracking-wider">Premium Pro</span>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col gap-sm">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-md px-md py-md rounded-xl text-label-md transition-all duration-300 ${
                active
                  ? "bg-secondary-container text-on-secondary-container font-bold shadow-sm hover:shadow-md hover:scale-[0.98]"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
              }`}
            >
              <Icon size={24} weight={active ? "fill" : "regular"} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="mt-auto flex flex-col gap-sm pb-md">
        <CreditMeter variant="full" />
        <button
          onClick={signOut}
          className="w-full py-md rounded-xl text-label-md text-on-primary bg-primary shadow-[0_4px_12px_rgba(0,88,201,0.3)] hover:shadow-[0_8px_20px_rgba(0,88,201,0.4)] hover:scale-[0.98] active:scale-95 transition-all duration-300 mb-md"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
