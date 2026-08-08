"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  SquaresFour,
  FileDashed,
  FileText,
  RocketLaunch,
  Path,
  Users,
  ChartLineUp,
  Gear,
  Headset,
  MicrophoneStage,
  IdentificationCard,
} from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";

const NAV = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard", disabled: false },
  { href: "/profile", icon: IdentificationCard, label: "My Profile", disabled: false },
  { href: "/career-path", icon: Path, label: "Career Path", disabled: false },
  { href: "/jd", icon: FileDashed, label: "JD Analyzer", disabled: false },
  { href: "/interview", icon: MicrophoneStage, label: "Interview Center", disabled: false },
  { href: "/studio", icon: FileText, label: "Resume Builder", disabled: false },
  { href: "/networking", icon: Users, label: "Networking", disabled: false },
  { href: "/analytics", icon: ChartLineUp, label: "Analytics", disabled: false },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createBrowserClient();

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore sign-out errors — treat as signed out
    }
    router.push("/login");
  }

  function isActive(href: string, disabled: boolean) {
    if (disabled) return false;
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
        {NAV.map(({ href, icon: Icon, label, disabled }) => {
          const active = isActive(href, disabled);
          return (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-md px-md py-md rounded-xl text-label-md transition-all duration-300 ${
                active
                  ? "bg-secondary-container text-primary font-bold shadow-sm hover:shadow-md hover:scale-[0.98]"
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
        <button
          onClick={signOut}
          className="w-full py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-[#142175] to-[#000a56] shadow-[0_4px_12px_rgba(0,10,86,0.3)] hover:shadow-[0_8px_20px_rgba(0,10,86,0.4)] hover:scale-[0.98] active:scale-95 transition-all duration-300 mb-md"
        >
          Sign Out
        </button>
        <span className="flex items-center gap-md px-md py-md rounded-xl text-label-md text-on-surface-variant opacity-40 cursor-default">
          <Gear size={24} />
          <span>Settings</span>
        </span>
        <span className="flex items-center gap-md px-md py-md rounded-xl text-label-md text-on-surface-variant opacity-40 cursor-default">
          <Headset size={24} />
          <span>Support</span>
        </span>
      </div>
    </aside>
  );
}
