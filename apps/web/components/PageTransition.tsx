"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Changing the key forces React to unmount+remount on every route change,
  // which re-triggers the CSS animation defined in globals.css.
  //
  // Grows to fill <main> but never shrinks below its content. It used to be
  // flex-1 min-h-0, which clamped it to the screen and let a long page spill
  // out of it, so <main>'s bottom padding (the room left for the phone's tab
  // bar) sat above the spilled content and the last ~60px of every long page
  // stayed hidden under the tab bar, unreachable by scrolling.
  return (
    <div key={pathname} className="page-enter flex-[1_0_auto] flex flex-col">
      {children}
    </div>
  );
}
