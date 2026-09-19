import Link from "next/link";
import { CTA_PRIMARY, CTA_SECONDARY, CTA_SIZE_LG } from "./cta";
import { Reveal } from "./Reveal";

export function ClosingCta() {
  return (
    <section className="px-gutter pb-[80px] pt-md">
      <Reveal className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] border border-white/70 bg-white/60 px-lg py-[56px] text-center shadow-[0_30px_80px_-40px_rgba(27,58,143,0.45)] backdrop-blur-xl sm:py-[72px]">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_120%,rgba(42,79,181,0.22),transparent_70%)]" />
        <h2 className="relative mx-auto max-w-[40rem] text-[34px] font-bold leading-[1.08] tracking-[-0.03em] text-on-surface sm:text-[52px]">
          Your next application,{" "}
          <span className="font-[family-name:var(--font-display)] font-normal italic text-primary">tailored properly.</span>
        </h2>
        <p className="relative mx-auto mt-md max-w-[30rem] text-body-lg text-on-surface-variant">
          Start free. Bring your résumé, paste a job, and see what changes before anything is saved.
        </p>
        <div className="relative mx-auto mt-xl flex max-w-[22rem] flex-col gap-sm sm:max-w-none sm:flex-row sm:justify-center sm:gap-md">
          <Link href="/register" className={`${CTA_PRIMARY} ${CTA_SIZE_LG} sm:min-w-[12.5rem]`}>
            Get Started Free
          </Link>
          <Link href="/login" className={`${CTA_SECONDARY} ${CTA_SIZE_LG} sm:min-w-[12.5rem]`}>
            Sign In
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
