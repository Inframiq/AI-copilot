"""A phone number written one standard way.

Résumés print phones every way there is: "(+91)-9966009727",
"+91-9966009727", "0091 99660 09727". The standard form is the country code
as "+91", a space, then the number in groups split by single spaces — an
Indian mobile as "99660 09727", the way it's written in India; any other
number keeps its own groups. An Indian mobile printed without its code
gets +91; any other number printed without one gets none.

apps/web/lib/phone.ts is the same function for the forms;
packages/types/phone-cases.json holds the cases both must pass.
"""
import re

# One plain number: digits, a leading + and the usual separators. Letters
# ("ext. 12"), or a slash or comma between two numbers, leave it as written.
_PLAIN = re.compile(r"^[\d+()\-.\s]+$")
# A country code: "+91", "(+91)", "0091", each followed by a separator.
_CODE = re.compile(r"^\(?\s*(?:\+|00)\s*(\d{1,3})\s*\)?(?=[\s\-.(])")
_INDIAN_MOBILE = re.compile(r"^[6-9]\d{9}$")

# ITU-T E.164 country calling codes. No code is the start of another, so the
# one at the front of a number run together ("+447946095800") is read off
# without a separator. apps/web/lib/phone.ts holds the same list (tested).
COUNTRY_CODES = frozenset("""
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
""".split())


def tidy_phone(raw: str | None) -> str:
    s = (raw or "").strip()
    if not s or not _PLAIN.match(s) or len(re.sub(r"\D", "", s)) < 7:
        return s
    code = None
    if m := _CODE.match(s):
        code, rest = m[1], s[m.end():]
    elif m := re.fullmatch(r"(?:\+|00)(\d+)", s):
        # Run together ("+919966009727"): the code is the country code it
        # starts with — at most one can match.
        digits = m[1]
        code = next((digits[:n] for n in (1, 2, 3) if digits[:n] in COUNTRY_CODES), None)
        if code is None:
            return "+" + digits
        rest = digits[len(code):]
    else:
        rest = s
    # "+44 (0)20 7946 0958": the (0) is dialled only from inside the country.
    if code:
        rest = re.sub(r"^\s*\(0\)", "", rest)
    groups = re.findall(r"\d+", rest)
    if not groups:
        return s
    national = "".join(groups)
    # "91-9966009727": India's code written without its "+".
    if code is None and len(national) == 12 and national.startswith("91") and _INDIAN_MOBILE.match(national[2:]):
        code, national = "91", national[2:]
        groups = [national]
    # No code at all: an Indian mobile — ten digits from 6 to 9, run
    # together or split 5-5, after an optional 0 — gets +91 (the user's
    # call: most users are in India). Other shapes ("080-2345 6789", "996
    # 600 9727", "(206) 555-0142") could be anywhere, and get no code.
    if code is None:
        sizes = [len(g) for g in groups]
        mobile = national
        if len(national) == 11 and national.startswith("0"):
            mobile = national[1:]
            sizes = [sizes[0] - 1, *sizes[1:]] if sizes[0] > 1 else sizes[1:]
        if _INDIAN_MOBILE.match(mobile) and sizes in ([10], [5, 5]):
            code, national, groups = "91", mobile, [mobile]
    # A landline written in its own groups ("80 2345 6789") keeps them: only
    # a number run together, or already split 5-5, reads as a mobile.
    if code == "91" and _INDIAN_MOBILE.match(national) and [len(g) for g in groups] in ([10], [5, 5]):
        number = f"{national[:5]} {national[5:]}"
    else:
        number = " ".join(groups)
    return f"+{code} {number}" if code else number
