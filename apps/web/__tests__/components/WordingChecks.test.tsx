// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WordingChecks } from "../../components/studio/review/WordingChecks";

const GAP = {
  key: "exp0_b3", where: "Engineer · Acme",
  text: "Rebuilt the service scaffolding.",
  question: "How much faster did a new service start up?",
};
const NONE = { verbs: [], phrases: [] };

describe("WordingChecks", () => {
  it("renders nothing when there is nothing to fix", () => {
    const { container } = render(
      <WordingChecks gaps={[]} quantified={1} repetition={NONE} onSaveBullet={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("asks for a number and saves the user's own text", () => {
    const onSave = vi.fn();
    render(<WordingChecks gaps={[GAP]} quantified={0.4} repetition={NONE} onSaveBullet={onSave} />);
    expect(screen.getByText(/40% of bullets have one/)).toBeTruthy();
    expect(screen.getByText(GAP.question)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /add my number/i }));
    fireEvent.change(screen.getByLabelText(/bullet with your number/i), {
      target: { value: "Rebuilt the service scaffolding, cutting setup from 3 weeks to 2 days." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(
      "exp0_b3", "Rebuilt the service scaffolding, cutting setup from 3 weeks to 2 days.",
    );
  });

  it("does not save an unchanged bullet", () => {
    const onSave = vi.fn();
    render(<WordingChecks gaps={[GAP]} quantified={0.4} repetition={NONE} onSaveBullet={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /add my number/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("lists overused verbs and phrases", () => {
    render(
      <WordingChecks
        gaps={[]}
        quantified={1}
        repetition={{ verbs: [{ text: "led", count: 3 }], phrases: [{ text: "platform development", count: 4 }] }}
        onSaveBullet={vi.fn()}
      />,
    );
    expect(screen.getByRole("article", { name: /repeated wording/i }).textContent).toMatch(/led opens 3 bullets/i);
    expect(screen.getByText(/platform development/)).toBeTruthy();
  });
});
