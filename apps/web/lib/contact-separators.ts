/**
 * A contact line that wraps must not leave its separator at the end of a
 * line ("Hyderabad, India |").
 *
 * The templates mark each separator (`data-contact-sep`) and join it to the
 * item before it with a non-breaking space, so a wrap can only fall after a
 * separator. One whose next item starts lower down ended a line, and is
 * hidden — `visibility`, not `display`: it keeps its width, so nothing
 * reflows and the line breaks stay the ones the PDF has. The PDF does the
 * same with WeasyPrint's layout (apps/api/app/services/pdf.py,
 * _line_end_separators); the two agree because both lay out the same
 * fonts at the same width.
 *
 * Returns how many were hidden.
 */
export function hideLineEndSeparators(root: ParentNode): number {
  const seps = Array.from(root.querySelectorAll<HTMLElement>("[data-contact-sep]"));
  // Reset first: an edit or a font arriving can unwrap a line.
  for (const sep of seps) sep.style.visibility = "";
  let hidden = 0;
  for (const sep of seps) {
    const next = sep.nextElementSibling;
    if (!next) continue;
    // Positions are read after every reset; visibility never moves layout.
    if (next.getBoundingClientRect().top > sep.getBoundingClientRect().top + 1) {
      sep.style.visibility = "hidden";
      hidden += 1;
    }
  }
  return hidden;
}
