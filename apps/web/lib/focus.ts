/**
 * The keyboard focus ring for Builder and Studio chrome.
 *
 * `focus-visible` rather than `focus`, so a mouse click never draws it. The
 * section editors already ring their inputs with `focus:ring-primary/30`;
 * this is the equivalent for buttons, which had nothing but the browser
 * default and lost it entirely on the primary-coloured ones.
 */
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
