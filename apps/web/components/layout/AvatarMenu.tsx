"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CaretUpDown, SignOut, User } from "@phosphor-icons/react";
import { ACCOUNT_NAV } from "@/lib/nav";
import { getCareerProfile } from "@/lib/career-profile-client";
import { useAvatarSrc } from "@/lib/avatar-url";
import { leaveSignedOut, signOutHere } from "@/lib/supabase";
import { confirmLeave, hasUnsavedWork } from "@/lib/use-leave-warning";

const UNSAVED_MESSAGE = "Unsaved changes will be lost. Sign out anyway?";

/** "Asha Rao" → "AR", "Asha" → "A"; null when there is no name to use. */
export function initials(name: string | null | undefined): string | null {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const letters = words.length === 1 ? words[0][0] : words[0][0] + words.at(-1)![0];
  return letters.toUpperCase();
}

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  const letters = initials(name);
  const box = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={box} className="shrink-0 rounded-full object-cover border border-outline-variant/30" />;
  }
  return (
    <span
      aria-hidden
      style={box}
      className="shrink-0 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-[12px] font-bold leading-none"
    >
      {letters ?? <User size={size * 0.55} weight="bold" />}
    </span>
  );
}

/**
 * The signed-in user's avatar — their profile photo, or initials — and the
 * menu behind it: My Profile, Account, Sign out. `sidebar` is the laptop
 * sidebar's row (menu opens upward), `rail` the collapsed sidebar's circle
 * (menu opens beside it), `header` the phone top bar's circle (menu drops
 * down).
 */
export function AvatarMenu({ variant }: { variant: "sidebar" | "rail" | "header" }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const { data: profile } = useQuery({ queryKey: ["careerProfile"], queryFn: () => getCareerProfile() });
  const photo = useAvatarSrc(profile?.photo_url ?? null);
  const name = profile?.contact?.name?.trim() ?? "";
  const email = profile?.contact?.email?.trim() ?? "";

  // Navigating away closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  // While open: a click outside or Escape closes it; the arrow keys move
  // between its items.
  useEffect(() => {
    if (!open) return;
    const items = () => [...(boxRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    items()[0]?.focus();
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        const step = e.key === "ArrowDown" ? 1 : -1;
        list[(at + step + list.length) % list.length]?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSignOut() {
    if (!confirmLeave(hasUnsavedWork(), UNSAVED_MESSAGE)) return;
    setOpen(false);
    await signOutHere();
    queryClient.clear();
    leaveSignedOut();
  }

  const label = name ? `Account menu for ${name}` : "Account menu";
  const placement =
    variant === "sidebar"
      ? "left-0 right-0 bottom-full mb-xs"
      : variant === "rail"
        ? "left-full bottom-0 ml-sm w-60"
        : "right-0 top-full mt-xs w-60";

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={variant === "sidebar" ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // The guided tour spotlights the sidebar's avatar for its profile
        // step; the tour doesn't run on a phone.
        data-tour={variant === "header" ? undefined : "/profile"}
        className={
          variant === "sidebar"
            ? `w-full flex items-center gap-sm px-sm py-xs rounded-xl text-left transition-colors ${
                open ? "bg-surface-container-high/60" : "hover:bg-surface-container-high/40"
              }`
            : variant === "rail"
              ? `mx-auto flex items-center justify-center p-1 rounded-full transition-colors ${
                  open ? "bg-surface-container-high/60" : "hover:bg-surface-container-high/40"
                }`
              : "shrink-0 flex items-center justify-center rounded-full active:opacity-80"
        }
      >
        <Avatar src={photo} name={name} size={variant === "header" ? 28 : 32} />
        {variant === "sidebar" && (
          <>
            <span className="flex-1 min-w-0">
              <span className="block truncate text-label-md font-semibold text-on-surface">
                {name || "My Profile"}
              </span>
              {email && <span className="block truncate text-caption text-on-surface-variant">{email}</span>}
            </span>
            <CaretUpDown size={16} className="shrink-0 text-on-surface-variant" />
          </>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className={`absolute z-50 ${placement} rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl shadow-on-surface/10 p-xs animate-[page-fade_0.12s_ease_both]`}
        >
          {variant !== "sidebar" && (name || email) && (
            <div className="px-sm pt-xs pb-sm mb-xs border-b border-outline-variant/20 min-w-0">
              {name && <p className="truncate text-label-md font-semibold text-on-surface">{name}</p>}
              {email && <p className="truncate text-caption text-on-surface-variant">{email}</p>}
            </div>
          )}
          {ACCOUNT_NAV.map(({ href, icon: Icon, label: itemLabel }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              aria-current={pathname === href ? "page" : undefined}
              className="flex items-center gap-sm px-sm py-sm rounded-lg text-label-md text-on-surface hover:bg-surface-container-high/50 focus:bg-surface-container-high/50 outline-none"
            >
              <Icon size={18} className="shrink-0 text-on-surface-variant" />
              {itemLabel}
            </Link>
          ))}
          <div className="my-xs border-t border-outline-variant/20" />
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="w-full flex items-center gap-sm px-sm py-sm rounded-lg text-label-md text-error hover:bg-error/5 focus:bg-error/5 outline-none"
          >
            <SignOut size={18} className="shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
