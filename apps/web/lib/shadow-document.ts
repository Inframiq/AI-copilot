/**
 * Make a whole-document stylesheet work inside a shadow root.
 *
 * Assigning a full HTML document to a shadow root's innerHTML drops the
 * <html>, <head> and <body> tags — the parser keeps their children and throws
 * the elements away. Every `body { ... }` rule then selects nothing, so the
 * résumé's body font, size, line-height and colour were all silently absent
 * from the Studio: its text rendered at the browser's default 16px while the
 * PDF used the template's 10pt.
 *
 * `:host` is that same element in shadow terms, and font properties inherit
 * from it into the tree, so the rule lands where it was always meant to. Outer
 * styles still beat `:host`, which is what keeps the canvas's own centring and
 * page geometry in charge of layout.
 */

// A `body` selector at the start of a rule, alone or leading a group. The
// lookarounds keep `.bodycopy` and `td.body-cell` out of it.
const BODY_SELECTOR = /(^|[\s,{}])body(?=\s*[,{])/g;

export function scopeBodyToHost(html: string): string {
  return html.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (block, css: string) => block.replace(css, css.replace(BODY_SELECTOR, "$1:host")),
  );
}
