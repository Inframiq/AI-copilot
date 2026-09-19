// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/analytics/PlanTracker", () => ({ PlanTracker: () => <div /> }));
vi.mock("@/components/legal/PolicyUpdatePrompt", () => ({ PolicyUpdatePrompt: () => <div /> }));

import BuilderLayout from "../app/(builder)/layout";

describe("(builder) layout", () => {
  it("renders its children", () => {
    render(<BuilderLayout><p>child</p></BuilderLayout>);
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("mounts no app sidebar — the Builder owns the whole viewport", () => {
    const { container } = render(<BuilderLayout><p>child</p></BuilderLayout>);
    expect(container.querySelector("aside")).toBeNull();
  });

  it("mounts no top nav", () => {
    const { container } = render(<BuilderLayout><p>child</p></BuilderLayout>);
    expect(container.querySelector("header")).toBeNull();
  });
});
