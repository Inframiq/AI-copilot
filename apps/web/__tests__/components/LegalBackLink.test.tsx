// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let session: unknown = null;
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}));

import { LegalBackLink } from "@/components/legal/LegalBackLink";

describe("LegalBackLink", () => {
  it("leads a signed-in reader back to the dashboard", async () => {
    session = { access_token: "t" };
    render(<LegalBackLink />);
    const link = await screen.findByRole("link", { name: "Back to dashboard" });
    expect(link.getAttribute("href")).toBe("/dashboard");
  });

  it("leads a signed-out reader back home", async () => {
    session = null;
    render(<LegalBackLink />);
    const link = await screen.findByRole("link", { name: "Back to home" });
    expect(link.getAttribute("href")).toBe("/");
  });
});
