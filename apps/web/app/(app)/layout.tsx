import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-on-background h-full flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <main className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-y-auto w-full">
        <TopNav />
        {children}
      </main>
    </div>
  );
}
