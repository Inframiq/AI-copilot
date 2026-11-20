// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PointsTextarea } from "@/components/profile/PointsTextarea";

function Box({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <PointsTextarea id="b" label="Points" value={value} onChange={setValue} placeholder="" />;
}

describe("PointsTextarea — a Profile box of résumé points", () => {
  it("starts what's typed into an empty box as a point, and Enter starts the next", async () => {
    render(<Box />);
    const box = screen.getByLabelText("Points") as HTMLTextAreaElement;
    await userEvent.type(box, "Built the API{Enter}Mentored two juniors");
    expect(box.value).toBe("• Built the API\n• Mentored two juniors");
  });

  it("makes pasted lines points", async () => {
    render(<Box />);
    const box = screen.getByLabelText("Points") as HTMLTextAreaElement;
    box.focus();
    await userEvent.paste("Built the API\n- Cut costs 20%");
    expect(box.value).toBe("• Built the API\n- Cut costs 20%");
  });

  it("Enter in the middle of a point splits it into two", async () => {
    render(<Box initial="• Built the APIMentored" />);
    const box = screen.getByLabelText("Points") as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(15, 15);
    await userEvent.keyboard("{Enter}");
    expect(box.value).toBe("• Built the API\n• Mentored");
    expect(box.selectionStart).toBe(18);
  });

  it("grows with its text instead of scrolling", () => {
    render(<Box initial="• Built the API" />);
    const box = screen.getByLabelText("Points");
    expect(box.className).toContain("overflow-hidden");
    expect(box.style.height).toMatch(/px$/);
  });
});
