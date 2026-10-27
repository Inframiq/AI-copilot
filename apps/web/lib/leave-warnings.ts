/**
 * The off switch for every "leave without saving?" prompt (the Studio
 * draft, the Profile form, a cover letter draft).
 *
 * A security exit — signed out, or another account signed in on another
 * tab — leaves with window.location.replace, and a page with unsaved work
 * answers that with the browser's "Leave site?" prompt. Choosing Stay kept
 * the page, and its data, on screen after the session had ended (tests
 * ATK-008, ATK-049). Such an exit turns the prompts off first.
 *
 * Kept free of React and of client-only imports: lib/supabase.ts, which the
 * middleware also loads, calls it.
 */
let standingDown = false;

export function standDownLeaveWarnings(): void {
  standingDown = true;
}

export function leaveWarningsStoodDown(): boolean {
  return standingDown;
}
