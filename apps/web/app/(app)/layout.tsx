import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { CursorGlow } from "@/components/CursorGlow";
import { PageTransition } from "@/components/PageTransition";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Canvas sits at z:0 in the ROOT stacking context — behind everything */}
      <CursorGlow />
      {/*
        Layout wrapper is z:1 in the ROOT stacking context.
        Being a stacking context itself (relative + z-index), its entire
        rendering — including every opaque card inside — paints above the canvas.
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
