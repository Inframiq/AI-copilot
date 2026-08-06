"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  SquaresFour, FileDashed, FileText, Brain, Gear, Headset, RocketLaunch
} from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";

const NAV = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard" },
  { href: "/resumes", icon: FileText, label: "Resume Builder" },
  { href: "/jd", icon: FileDashed, label: "JD Analyzer" },
  { href: "/interview", icon: Brain, label: "Interview Center" },
];

const BOTTOM = [
  { href: "/settings", icon: Gear, label: "Settings" },
  { href: "/support", icon: Headset, label: "Support" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createBrowserClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function NavItem({ href, icon: Icon, label }: { href: string; icon: typeof SquaresFour; label: string }) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link href={href}
        className={`flex items-center gap-md px-md py-md rounded-xl text-label-md font-label-md transition-all duration-300 ${
          active
            ? "bg-secondary-container text-primary font-bold shadow-sm"
            : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
        }`}>
        <Icon size={24} weight={active ? "fill" : "regular"} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <aside className="hidden md:flex flex-col p-md gap-sm bg-surface-container-lowest/80 backdrop-blur-xl h-screen w-[280px] left-0 fixed border-r border-outline-variant/20 shadow-sm z-50">
      <div className="flex items-center gap-md px-md py-lg mb-md">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
          <RocketLaunch size={20} weight="fill" className="text-on-primary" />
        </div>
        <div>
          <p className="text-headline-md font-black text-primary">Career Copilot</p>
          <p className="text-caption text-secondary uppercase tracking-wider">Pro</p>
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-sm">
        {NAV.map(item => <NavItem key={item.href} {...item} />)}
      </nav>
      <div className="mt-auto flex flex-col gap-sm pb-md">
        <button onClick={signOut}
          className="w-full py-md rounded-xl text-label-md font-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all mb-md">
          Sign Out
        </button>
        {BOTTOM.map(item => <NavItem key={item.href} {...item} />)}
      </div>
    </aside>
  );
}
