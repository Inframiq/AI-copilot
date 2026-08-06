"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Changing the key forces React to unmount+remount on every route change,
  // which re-triggers the CSS animation defined in globals.css.
  return (
    <div key={pathname} className="page-enter flex-1 flex flex-col min-h-0">
      {children}
    </div>
  );
}
