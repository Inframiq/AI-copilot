// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { BetaBadge, BETA_NOTE } from "../components/ui/BetaBadge";

// Every header a visitor can land on — the landing page, sign-in, the app
// shell (phone and desktop), the Builder and Studio, admin, the legal pages,
// and the 404 and error pages — carries the badge while the product is in beta.
const SHELLS = [
  "components/marketing/LandingNav.tsx",
  "components/marketing/LandingFooter.tsx",
  "app/(auth)/login/page.tsx",
  "app/(auth)/register/page.tsx",
  "components/layout/TopNav.tsx",
  "components/builder/BuilderHeader.tsx",
  "components/studio/StudioHeader.tsx",
  "app/admin/page.tsx",
  "app/terms/page.tsx",
  "app/privacy/page.tsx",
  "app/refunds/page.tsx",
  "app/cookies/page.tsx",
  "app/data-deletion/page.tsx",
  "app/not-found.tsx",
  "app/error.tsx",
];

describe("BetaBadge", () => {
  it("reads Beta and explains itself on hover", () => {
    render(<BetaBadge />);
    const badge = screen.getByTestId("beta-badge");
    expect(badge.textContent).toBe("Beta");
    expect(badge.getAttribute("title")).toBe(BETA_NOTE);
  });

  it("is in every page header", () => {
    for (const file of SHELLS) {
      expect(readFileSync(join(process.cwd(), file), "utf8"), file).toContain("<BetaBadge");
    }
  });

  it("is in the phone header and the desktop top bar of the app shell", () => {
    const topNav = readFileSync(join(process.cwd(), "components/layout/TopNav.tsx"), "utf8");
    expect(topNav.match(/<BetaBadge/g)?.length).toBe(2);
  });
});
