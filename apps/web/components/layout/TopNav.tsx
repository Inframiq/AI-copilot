"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { DotsThreeOutline, MagnifyingGlass, X } from "@phosphor-icons/react";
import { CreditMeter } from "./CreditMeter";
import { FeedbackWidget } from "../feedback/FeedbackWidget";
import { APP_NAV, PHONE_TABS, isActive } from "@/lib/nav";

const TABS = PHONE_TABS.map((href) => APP_NAV.find((n) => n.href === href)!);
const MORE = APP_NAV.filter((n) => !PHONE_TABS.includes(n.href));

export function TopNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((n) => isActive(pathname, n.href));

  // Navigating away closes the sheet; so does Escape.
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      {/* Mobile Top Header */}
      <header className="md:hidden flex justify-between items-center w-full px-md h-12 bg-surface/85 backdrop-blur-md sticky top-0 z-40 border-b border-outline-variant/30 shadow-sm">
        <Link href="/dashboard" className="flex items-center">
          <Image src="/brand/logo-wordmark.png" alt="KripaX" width={100} height={22} priority />
        </Link>
        <div className="flex items-center gap-xs">
          <FeedbackWidget />
          <CreditMeter variant="compact" />
        </div>
      </header>

      {/* Desktop Top Bar — search + actions */}
      <header className="hidden md:flex justify-between items-center w-full px-lg h-14 bg-surface/80 backdrop-blur-md sticky top-0 z-30 border-b border-outline-variant/20 shrink-0">
        <div className="flex items-center bg-surface-container-low rounded-full px-md py-sm ml-sm border border-outline-variant/30 w-80">
          <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
          <input
            className="bg-transparent border-none focus:ring-0 text-body-sm text-on-surface w-full ml-sm outline-none placeholder:text-on-surface-variant/60"
            placeholder="Search resources..."
            type="text"
            readOnly
          />
        </div>
        <div className="flex items-center gap-md">
          <FeedbackWidget />
          <CreditMeter variant="compact" />
        </div>
      </header>

      {/* Mobile Bottom Tab Bar — four pages and "More" for the rest, so every
          page the laptop sidebar offers is reachable on a phone. Padded for
          the iPhone home indicator. */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-outline-variant/30 grid grid-cols-5 px-xs pt-1 pb-[max(4px,env(safe-area-inset-bottom))]"
      >
        {TABS.map(({ href, icon: Icon, label, short }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors ${
                active ? "text-primary" : "text-on-surface-variant active:text-on-surface"
              }`}
            >
              <Icon size={22} weight={active ? "fill" : "regular"} />
              <span className="text-[10px] font-semibold leading-tight">{href === "/dashboard" ? label : short ?? label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-controls="more-sheet"
          className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors ${
            moreActive || moreOpen ? "text-primary" : "text-on-surface-variant active:text-on-surface"
          }`}
        >
          <DotsThreeOutline size={22} weight={moreActive || moreOpen ? "fill" : "regular"} />
          <span className="text-[10px] font-semibold leading-tight">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" id="more-sheet">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-on-surface/30 backdrop-blur-[2px] animate-[page-fade_0.15s_ease_both]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More pages"
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-outline-variant/30 bg-surface-container-lowest px-md pt-sm pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl animate-[card-enter_0.25s_cubic-bezier(0.22,1,0.36,1)_both]"
          >
            <div className="mx-auto mb-sm h-1 w-10 rounded-full bg-outline-variant/60" aria-hidden />
            <div className="mb-sm flex items-center justify-between">
              <p className="text-label-md font-semibold text-on-surface">More</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-on-surface-variant active:bg-surface-container"
              >
                <X size={18} />
              </button>
            </div>
            <ul className="grid grid-cols-4 gap-sm">
              {MORE.map(({ href, icon: Icon, label, short }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-sm text-center transition-colors ${
                        active
                          ? "bg-secondary-container text-on-secondary-container"
                          : "bg-surface-container-low text-on-surface active:bg-surface-container"
                      }`}
                    >
                      <Icon size={24} weight={active ? "fill" : "regular"} />
                      <span className="text-[11px] font-semibold leading-tight">{short ?? label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
