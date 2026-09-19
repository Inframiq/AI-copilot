/**
 * Every call to action on the landing page shares one shape — height,
 * corners, elevation — and differs only in fill. Get Started and Sign In used
 * to differ in all three, which read as two unrelated buttons rather than a
 * primary and a secondary choice.
 */
const BASE =
  "inline-flex items-center justify-center gap-xs rounded-xl text-label-md font-semibold whitespace-nowrap " +
  "shadow-[0_1px_2px_rgba(23,24,29,0.06),0_6px_16px_-6px_rgba(23,24,29,0.18)] " +
  "hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(23,24,29,0.06),0_12px_24px_-8px_rgba(23,24,29,0.22)] " +
  "active:translate-y-0 transition-[transform,box-shadow,background-color] duration-200 ease-out " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0";

export const CTA_PRIMARY = `${BASE} bg-primary text-on-primary hover:bg-primary-container`;
export const CTA_SECONDARY =
  `${BASE} bg-surface-container-lowest text-on-surface ring-1 ring-inset ring-outline-variant/70 hover:bg-surface-container-low`;
/** On a dark section: same shape, light fill. */
export const CTA_ON_DARK = `${BASE} bg-white text-on-surface hover:bg-primary-fixed`;

export const CTA_SIZE_LG = "px-xl py-md";
export const CTA_SIZE_SM = "px-md sm:px-lg py-sm";
