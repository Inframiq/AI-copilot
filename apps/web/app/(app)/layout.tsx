import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { PageTransition } from "@/components/PageTransition";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        CursorGlow now renders once in the root layout so it covers the
        landing page and auth pages too. This wrapper is z:1 in the ROOT
        stacking context; being a stacking context itself (relative + z-index),
        its entire rendering — including every opaque card inside — paints
        above the canvas.
      */}
      <div className="text-on-background h-full flex flex-col md:flex-row overflow-hidden relative z-[1]">
        <Sidebar />
        <main className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-y-auto w-full">
          <TopNav />
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </>
  );
}
