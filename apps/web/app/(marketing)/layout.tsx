import { LightfallBackground } from "@/components/backgrounds/LightfallBackground";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LightfallBackground />
      {children}
    </>
  );
}
