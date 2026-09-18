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

/**
 * Press feedback for Builder and Studio buttons: a quick shrink on click and
 * eased colour changes, so every press visibly lands. Off under reduced
 * motion; the colour change alone still confirms the press.
 */
export const PRESS =
  "transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100";
