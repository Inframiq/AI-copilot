import { describe, it, expect } from "vitest";
import { PHONE_CHANGE_DAYS, contactDifferences, lockedEmail, lockedName, mergeParsedContact, phoneChangeableFrom } from "@/lib/contact-lock";

describe("contact details are the user's, not the résumé's", () => {
  it("keeps every filled field and fills only the empty ones from a parsed résumé", () => {
    const merged = mergeParsedContact(
      { name: "Jane Smith", email: "j@x.com", phone: "+91 98765 43210", location: "" },
      { name: "J. Smith", email: "old@work.com", phone: "555-0100", location: "Pune", linkedin: "linkedin.com/in/jane" },
      "jane@account.com",
    );
    expect(merged).toEqual({
      name: "Jane Smith",
      email: "jane@account.com",
      phone: "+91 98765 43210",
      location: "Pune",
      linkedin: "linkedin.com/in/jane",
    });
  });

  it("never takes the email from a résumé", () => {
    expect(mergeParsedContact({ name: "", email: "" }, { email: "old@work.com" }, null).email).toBe("");
  });

  it("uses the sign-in email whenever it is known", () => {
    expect(lockedEmail("typed@else.com", "jane@account.com")).toBe("jane@account.com");
    expect(lockedEmail("j@x.com", null)).toBe("j@x.com");
  });

  it("offers only details the résumé prints differently, never the name or email", () => {
    const mine = {
      name: "Jane Smith", email: "jane@account.com", phone: "+91 98765 43210", location: "Pune",
      linkedin: "linkedin.com/in/jane", github: "", website: "https://jane.dev/",
    };
    expect(contactDifferences(mine, {
      name: "jane smith", email: "old@work.com", phone: "98765-43210", location: "Hyderabad",
      linkedin: "https://www.linkedin.com/in/jane/", github: "github.com/jane", website: "jane.dev",
    })).toEqual([{ field: "location", value: "Hyderabad" }]);
    expect(contactDifferences(mine, { name: "Jane S.", phone: "+1 555 010 0100" })).toEqual([
      { field: "phone", value: "+1 555 010 0100" },
    ]);
    expect(contactDifferences(mine, undefined)).toEqual([]);
  });

  it("keeps the saved name once there is one", () => {
    expect(lockedName("Someone Else", "Jane Smith")).toBe("Jane Smith");
    expect(lockedName("", "Jane Smith")).toBe("Jane Smith");
    expect(lockedName(" Jane Smith ", "")).toBe("Jane Smith");
    expect(lockedName("Jane Smith", null)).toBe("Jane Smith");
  });

  it("says when the phone can change again: 30 days after its last change", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(PHONE_CHANGE_DAYS).toBe(30);
    expect(phoneChangeableFrom(null, now)).toBeNull();
    expect(phoneChangeableFrom("2026-11-10T12:00:00Z", now)).toEqual(new Date("2026-12-10T12:00:00Z"));
    expect(phoneChangeableFrom("2026-10-20T11:59:00Z", now)).toBeNull();
    expect(phoneChangeableFrom("not a date", now)).toBeNull();
  });
});
