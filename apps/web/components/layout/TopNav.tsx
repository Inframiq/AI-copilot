"use client";
import { Bell, List, RocketLaunch } from "@phosphor-icons/react";

export function TopNav() {
  return (
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
        <button className="text-on-surface-variant hover:bg-surface-container-high/50 p-sm rounded-full transition-colors">
          <List size={24} />
        </button>
      </div>
    </header>
  );
}
