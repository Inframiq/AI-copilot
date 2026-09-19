import { LiquidEtherBackground } from "@/components/backgrounds/LiquidEtherBackground";

export default function RefundsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiquidEtherBackground />
      <div className="relative z-[1]">{children}</div>
    </>
  );
}
