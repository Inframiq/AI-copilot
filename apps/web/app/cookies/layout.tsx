import { LiquidEtherBackground } from "@/components/backgrounds/LiquidEtherBackground";

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiquidEtherBackground />
      <div className="relative z-[1]">{children}</div>
    </>
  );
}
