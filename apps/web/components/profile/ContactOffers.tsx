"use client";
import { FileArrowUp } from "@phosphor-icons/react";
import type { ContactInfo } from "@/lib/career-profile-client";
import type { ContactDifference, FillableContactField } from "@/lib/contact-lock";
import { FOCUS_RING, PRESS } from "@/lib/focus";

const LABEL: Record<FillableContactField, string> = {
  name: "Full name", phone: "Phone", location: "Location",
  linkedin: "LinkedIn", github: "GitHub", website: "Website",
};

/**
 * Contact details an uploaded résumé prints differently from the profile
 * (lib/contact-lock contactDifferences), each beside the profile's own, to
 * take one at a time or all at once. Nothing changes unless one is chosen;
 * like every other edit here, a choice is saved with Save Profile.
 */
export function ContactOffers({ offers, contact, onUse, onDismiss }: {
  offers: ContactDifference[];
  contact: ContactInfo;
  onUse: (picked: ContactDifference[]) => void;
  onDismiss: () => void;
}) {
  if (offers.length === 0) return null;
  const btn = `shrink-0 rounded-lg px-sm py-xs text-label-sm font-semibold ${PRESS} ${FOCUS_RING}`;
  return (
    <div role="region" aria-label="Details from the uploaded résumé"
      className="mb-md overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.03]">
      <div className="flex items-start gap-sm border-b border-outline-variant/30 px-md py-sm">
        <FileArrowUp size={18} className="mt-[2px] shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-label-md font-semibold text-on-surface">Different on the uploaded résumé</p>
          <p className="text-caption text-on-surface-variant">Your profile keeps its own details unless you choose one.</p>
        </div>
      </div>
      <ul className="divide-y divide-outline-variant/30">
        {offers.map((offer) => {
          const label = LABEL[offer.field];
          return (
            <li key={offer.field} className="flex items-center gap-sm px-md py-sm">
              <dl className="grid min-w-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-sm gap-y-[2px] text-body-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
                <dt className="col-span-2 text-label-sm font-semibold text-on-surface">{label}</dt>
                <dd className="contents">
                  <span className="text-caption text-on-surface-variant">Profile</span>
                  <span className="truncate text-on-surface-variant">{contact[offer.field] || "—"}</span>
                  <span className="text-caption text-primary">Résumé</span>
                  <span className="font-medium text-on-surface [overflow-wrap:anywhere]">{offer.value}</span>
                </dd>
              </dl>
              <button type="button" aria-label={`Use ${offer.value} as ${label}`} onClick={() => onUse([offer])}
                className={`${btn} border border-primary/40 bg-surface-container-lowest text-primary hover:bg-primary/5`}>
                Use this
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-sm border-t border-outline-variant/30 bg-surface-container-lowest/60 px-md py-sm">
        <button type="button" onClick={onDismiss}
          className={`${btn} text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface`}>
          Keep mine
        </button>
        {offers.length > 1 && (
          <button type="button" onClick={() => onUse(offers)}
            className={`${btn} bg-primary text-on-primary hover:opacity-90`}>
            Use all
          </button>
        )}
      </div>
    </div>
  );
}
