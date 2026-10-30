/**
 * A phone number written one standard way: the country code as "+91", a
 * space, then the number in groups split by single spaces — an Indian mobile
 * as "99660 09727", any other number in its own groups. "(+91)-9966009727"
 * and "9966009727" both become "+91 99660 09727": an Indian mobile typed
 * without its code gets +91, any other number gets none. Anything but one
 * plain number (an extension, two numbers) stays as typed.
 *
 * apps/api/app/services/phone.py is the same function for the résumé reader
 * and the PDF; packages/types/phone-cases.json holds the cases both pass.
 */

const PLAIN = /^[\d+()\-.\s]+$/;
const CODE = /^\(?\s*(?:\+|00)\s*(\d{1,3})\s*\)?(?=[\s\-.(])/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** ITU-T E.164 country calling codes; none is the start of another, so the
 * one at the front of "+447946095800" reads off without a separator. The
 * same list as COUNTRY_CODES in phone.py (tested). */
export const COUNTRY_CODES: ReadonlySet<string> = new Set(`
1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56
57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98
211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233
234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252
253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297
298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376
377 378 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505
506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 674 675
676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 800 808 850
852 853 855 856 870 878 880 881 882 883 886 888 960 961 962 963 964 965 966
967 968 970 971 972 973 974 975 976 977 979 992 993 994 995 996 998
`.trim().split(/\s+/));

export function tidyPhone(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s || !PLAIN.test(s) || s.replace(/\D/g, "").length < 7) return s;
  let code: string | null = null;
  let rest = s;
  const m = CODE.exec(s);
  const run = /^(?:\+|00)(\d+)$/.exec(s);
  if (m) {
    code = m[1];
    rest = s.slice(m[0].length);
  } else if (run) {
    // Run together: the code is the country code it starts with.
    const digits = run[1];
    code = [1, 2, 3].map((n) => digits.slice(0, n)).find((c) => COUNTRY_CODES.has(c)) ?? null;
    if (code === null) return `+${digits}`;
    rest = digits.slice(code.length);
  }
  // "+44 (0)20 7946 0958": the (0) is dialled only from inside the country.
  if (code) rest = rest.replace(/^\s*\(0\)/, "");
  let groups = rest.match(/\d+/g) ?? [];
  if (groups.length === 0) return s;
  let national = groups.join("");
  // "91-9966009727": India's code written without its "+".
  if (code === null && national.length === 12 && national.startsWith("91") && INDIAN_MOBILE.test(national.slice(2))) {
    code = "91";
    national = national.slice(2);
    groups = [national];
  }
  // No code at all: an Indian mobile — ten digits from 6 to 9, run together
  // or split 5-5, after an optional 0 — gets +91. Other shapes ("080-2345
  // 6789", "996 600 9727", "(206) 555-0142") could be anywhere, and get none.
  if (code === null) {
    let sizes = groups.map((g) => g.length);
    let mobile = national;
    if (national.length === 11 && national.startsWith("0")) {
      mobile = national.slice(1);
      sizes = sizes[0] > 1 ? [sizes[0] - 1, ...sizes.slice(1)] : sizes.slice(1);
    }
    if (INDIAN_MOBILE.test(mobile) && ["10", "5,5"].includes(sizes.join(","))) {
      code = "91";
      national = mobile;
      groups = [mobile];
    }
  }
  // A landline written in its own groups ("80 2345 6789") keeps them: only a
  // number run together, or already split 5-5, reads as a mobile.
  const sizes = groups.map((g) => g.length).join(",");
  const number = code === "91" && INDIAN_MOBILE.test(national) && (sizes === "10" || sizes === "5,5")
    ? `${national.slice(0, 5)} ${national.slice(5)}`
    : groups.join(" ");
  return code ? `+${code} ${number}` : number;
}
