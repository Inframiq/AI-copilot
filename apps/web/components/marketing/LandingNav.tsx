import Image from "next/image";
import Link from "next/link";
import { CTA_PRIMARY, CTA_SECONDARY, CTA_SIZE_SM } from "./cta";

/** Floating glass bar: stays in reach while the page scrolls under it. */
export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 px-gutter pt-md">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-[1200px] items-center justify-between gap-sm rounded-2xl border border-white/60 bg-white/70 py-2 pl-md pr-2 shadow-[0_8px_30px_-12px_rgba(23,24,29,0.18)] backdrop-blur-xl"
      >
        <Link href="/" aria-label="KripaX home" className="flex shrink-0 items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <Image src="/brand/logo-wordmark.png" alt="KripaX" width={128} height={28} priority />
        </Link>
        <div className="hidden items-center gap-lg text-label-md text-on-surface-variant md:flex">
          <a href="#how" className="transition-colors hover:text-on-surface">Process</a>
          <a href="#honest" className="transition-colors hover:text-on-surface">Trust</a>
          <a href="#beyond" className="transition-colors hover:text-on-surface">Features</a>
        </div>
        <div className="flex shrink-0 items-center gap-sm">
          {/* max-sm:, not hidden + sm:inline-flex: the CTA shape sets
              inline-flex itself, which beat a plain `hidden`. */}
          <Link href="/login" className={`max-sm:hidden ${CTA_SECONDARY} ${CTA_SIZE_SM}`}>
            Sign In
          </Link>
          <Link href="/register" className={`${CTA_PRIMARY} ${CTA_SIZE_SM}`}>
            Get Started Free
          </Link>
        </div>
      </nav>
    </header>
  );
}
