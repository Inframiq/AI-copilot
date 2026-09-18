/**
 * The browser half of the inline-formatting allowlist.
 *
 * Mirrors apps/api/app/services/rich_text.py, which sanitises again on every
 * render — this pass exists so the résumé does not *store* the wrapper divs
 * and inline styles contenteditable produces, not because the server trusts
 * it. If the two ever disagree, the server wins and nothing unsafe ships.
 *
 * Where the two deliberately differ: the server escapes a tag the user typed
 * as text, because a bullet mentioning <script> is describing code. Anything
 * reaching here is already a parsed element the browser built — from Enter,
 * from a paste — so it is unwrapped rather than escaped.
 */
const ALLOWED = new Set(["B", "I", "U", "STRONG", "EM"]);

// execCommand's own names, paired with what the button says.
export const RICH_COMMANDS = [
  { command: "bold", label: "Bold", shortcut: "⌘B" },
  { command: "italic", label: "Italic", shortcut: "⌘I" },
  { command: "underline", label: "Underline", shortcut: "⌘U" },
] as const;

// Elements that carry no text worth keeping; unwrapping a <script> would
// paste its source into the résumé.
const DROP_WHOLE = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE"]);

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serialize(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.textContent ?? "");
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = (child as Element).tagName;
    if (DROP_WHOLE.has(tag)) continue;
    const inner = serialize(child);
    // No attributes are carried across, so nothing needs escaping in the tag.
    out += ALLOWED.has(tag) ? `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>` : inner;
  }
  return out;
}

export function sanitizeInline(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return serialize(template.content);
}
