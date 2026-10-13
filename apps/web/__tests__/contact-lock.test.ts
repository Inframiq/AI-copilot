import { describe, it, expect } from "vitest";
import { lockedEmail, mergeParsedContact } from "@/lib/contact-lock";

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
});
