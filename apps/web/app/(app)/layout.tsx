import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { PageTransition } from "@/components/PageTransition";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-on-background h-full flex flex-col md:flex-row overflow-hidden relative z-[1]">
      <Sidebar />
      <main className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-y-auto w-full">
        <TopNav />
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
