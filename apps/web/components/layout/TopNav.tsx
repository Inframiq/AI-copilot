"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, RocketLaunch, SquaresFour, FileDashed, MicrophoneStage, FileText, MagnifyingGlass } from "@phosphor-icons/react";

const MOBILE_NAV = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard" },
  { href: "/jd", icon: FileDashed, label: "JD" },
  { href: "/interview", icon: MicrophoneStage, label: "Interview" },
  { href: "/studio", icon: FileText, label: "Resume" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile Top Header */}
      <header className="md:hidden flex justify-between items-center w-full px-lg h-16 bg-surface/80 backdrop-blur-md sticky top-0 z-40 border-b border-outline-variant/30 shadow-sm">
        <div className="flex items-center gap-sm">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <RocketLaunch size={18} weight="fill" className="text-on-primary" />
          </div>
          <span className="text-headline-md font-bold text-primary">Career Copilot</span>
        </div>
        <div className="flex items-center gap-md">
          <button className="text-on-surface-variant hover:bg-surface-container-high/50 p-sm rounded-full transition-colors">
            <Bell size={24} />
          </button>
        </div>
      </header>

      {/* Desktop Top Bar — search + actions */}
      <header className="hidden md:flex justify-between items-center w-full px-lg h-14 bg-surface/80 backdrop-blur-md sticky top-0 z-30 border-b border-outline-variant/20 shrink-0">
        <div className="flex items-center bg-surface-container-low rounded-full px-md py-sm border border-outline-variant/30 w-80">
          <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
          <input
            className="bg-transparent border-none focus:ring-0 text-body-sm text-on-surface w-full ml-sm outline-none placeholder:text-on-surface-variant/60"
            placeholder="Search resources..."
            type="text"
            readOnly
          />
        </div>
        <div className="flex items-center gap-md">
          <button className="p-sm text-on-surface-variant hover:bg-surface-container-high/50 transition-colors rounded-full">
            <Bell size={24} />
          </button>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-outline-variant/30 flex items-center justify-around h-16 px-sm">
        {MOBILE_NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={label}
              href={href}
              className={`flex flex-col items-center gap-xs py-xs px-md rounded-xl transition-colors ${
                active ? "text-primary" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon size={24} weight={active ? "fill" : "regular"} />
              <span className="text-caption font-semibold">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
