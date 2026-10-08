// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfilePoints } from "@/components/studio/review/ProfilePoints";
import type { MiscPoint } from "@/lib/misc-points";

const content = {
  contact: { name: "Jane", email: "" },
  experience: [{ title: "Engineer", company: "Acme", start: "2024", bullets: [] }],
  education: [],
  skills: [],
} as never;
const award: MiscPoint = { id: "a", text: "Won the hackathon", section: "awards", created_at: "" };
const loose: MiscPoint = { id: "m", text: "Speaks Telugu", section: "miscellaneous", created_at: "" };

function setup(props: Partial<Parameters<typeof ProfilePoints>[0]> = {}) {
  const onDecide = vi.fn();
  const onDestination = vi.fn();
  render(
    <ProfilePoints
      points={[award, loose]}
      content={content}
      decisions={{}}
      destinations={{}}
      onDecide={onDecide}
      onDestination={onDestination}
      {...props}
    />,
  );
  return { onDecide, onDestination };
}

describe("ProfilePoints", () => {
  it("renders nothing when the profile has no Miscellaneous points", () => {
    const { container } = render(
      <ProfilePoints
        points={[]} content={content} decisions={{}} destinations={{}}
        onDecide={vi.fn()} onDestination={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers every point switched off, headed where it was filed", async () => {
    const { onDecide } = setup();
    const group = screen.getByRole("region", { name: "From your profile" });
    const sw = within(group).getByRole("switch", { name: /Won the hackathon/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(within(group).getByRole("combobox", { name: /Won the hackathon/ })).toHaveValue("awards");
    await userEvent.setup().click(sw);
    expect(onDecide).toHaveBeenCalledWith("a", "accept");
  });

  it("won't switch on a miscellaneous point until a place is chosen", async () => {
    const { onDestination } = setup();
    expect(screen.getByRole("switch", { name: /Speaks Telugu/ })).toBeDisabled();
    const where = screen.getByRole("combobox", { name: /Speaks Telugu/ });
    expect(where).toHaveValue("");
    await userEvent.setup().selectOptions(where, "exp:0");
    expect(onDestination).toHaveBeenCalledWith("m", "exp:0");
  });

  it("shows a ticked point as on", () => {
    setup({ decisions: { "misc:a": "accept" } });
    expect(screen.getByRole("switch", { name: /Won the hackathon/ })).toHaveAttribute("aria-checked", "true");
  });
});
