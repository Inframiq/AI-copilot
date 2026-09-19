import Link from "next/link";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { CTA_PRIMARY, CTA_SECONDARY, CTA_SIZE_LG } from "./cta";
import { TailorDemo } from "./TailorDemo";

export function LandingHero() {
  return (
    <section className="mx-auto grid max-w-[1200px] items-center gap-xxl lg:items-start px-gutter pb-[72px] pt-xl lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-[72px] lg:pt-xxl">
      <div className="max-w-[36rem] lg:pt-xl">
        <p className="mb-lg inline-flex items-center gap-xs rounded-full border border-primary/15 bg-white/70 px-md py-1 text-caption font-medium text-primary backdrop-blur">
          <ShieldCheck size={14} weight="fill" />
          The résumé tailor that shows you every change
        </p>
        <h1 className="text-[44px] font-bold leading-[1.02] tracking-[-0.035em] text-on-surface sm:text-[60px] lg:text-[68px]">
          Tailored to every job.{" "}
          <span className="font-[family-name:var(--font-display)] font-normal italic tracking-[-0.01em] text-primary">
            True to you.
          </span>
        </h1>
        <p className="mt-lg max-w-[31rem] text-body-lg text-on-surface-variant">
          Paste a job description. KripaX rewrites your résumé in the job&apos;s own
          language, shows your match score rising with every change you accept, and
          holds back new numbers and new skills until you confirm them.
        </p>
        <div className="mt-xl flex flex-col gap-sm sm:flex-row sm:gap-md">
          <Link href="/register" className={`${CTA_PRIMARY} ${CTA_SIZE_LG} sm:min-w-[12.5rem]`}>
            Get Started Free
          </Link>
          <Link href="/login" className={`${CTA_SECONDARY} ${CTA_SIZE_LG} sm:min-w-[12.5rem]`}>
            Sign In
          </Link>
        </div>
        <ul className="mt-lg flex flex-wrap gap-x-lg gap-y-xs text-caption text-on-surface-variant">
          <li>Free to start</li>
          <li aria-hidden className="max-sm:hidden">·</li>
          <li>No card needed</li>
          <li aria-hidden className="max-sm:hidden">·</li>
          <li>You approve every change</li>
        </ul>
      </div>
      <TailorDemo />
    </section>
  );
}
