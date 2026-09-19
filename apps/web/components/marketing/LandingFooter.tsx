import Image from "next/image";
import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t border-outline-variant/40 bg-white/50 px-gutter py-xl backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-lg sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-xs">
          <Image src="/brand/logo-wordmark.png" alt="KripaX" width={110} height={24} />
          <p className="text-caption text-on-surface-variant">
            © {new Date().getFullYear()} Inframiq Solutions Private Limited. Résumé tailoring you can stand behind.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-lg gap-y-xs text-label-sm text-on-surface-variant">
          <Link href="/privacy" className="transition-colors hover:text-on-surface">Privacy</Link>
          <Link href="/terms" className="transition-colors hover:text-on-surface">Terms</Link>
          <Link href="/login" className="transition-colors hover:text-on-surface">Sign in</Link>
          <Link href="/register" className="transition-colors hover:text-on-surface">Create account</Link>
        </nav>
      </div>
    </footer>
  );
}
