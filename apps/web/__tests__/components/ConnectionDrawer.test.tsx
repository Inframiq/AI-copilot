// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionDrawer } from "../../components/networking/ConnectionDrawer";
import type { Profile } from "../../lib/networking-client";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    display_name: "Jane Doe",
    headline: "Senior Engineer",
    bio: "Loves distributed systems.",
    location: "San Francisco, CA",
    skills: ["React", "TypeScript"],
    open_to_work: true,
    available_for: ["full-time", "mentoring"],
    linkedin_url: "https://linkedin.com/in/jane",
    github_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ConnectionDrawer", () => {
  it("renders nothing when profile is null", () => {
    const { container } = render(
      <ConnectionDrawer
        profile={null}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        isRemoving={false}
        removeArmed={false}
        onArmRemove={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders profile details when a profile is passed", () => {
    render(
      <ConnectionDrawer
        profile={makeProfile()}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        isRemoving={false}
        removeArmed={false}
        onArmRemove={vi.fn()}
      />
    );
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Loves distributed systems.")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    expect(screen.getByText("Mentoring")).toBeInTheDocument();
  });

  it("calls onClose when the backdrop or close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <ConnectionDrawer
        profile={makeProfile()}
        onClose={onClose}
        onRemove={vi.fn()}
        isRemoving={false}
        removeArmed={false}
        onArmRemove={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "" })); // the X close button (no accessible name)
    expect(onClose).toHaveBeenCalled();
  });

  it("requires arming before actually removing the connection", async () => {
    const onArmRemove = vi.fn();
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ConnectionDrawer
        profile={makeProfile()}
        onClose={vi.fn()}
        onRemove={onRemove}
        isRemoving={false}
        removeArmed={false}
        onArmRemove={onArmRemove}
      />
    );

    await userEvent.click(screen.getByText("Remove Connection"));
    expect(onArmRemove).toHaveBeenCalledOnce();
    expect(onRemove).not.toHaveBeenCalled();

    rerender(
      <ConnectionDrawer
        profile={makeProfile()}
        onClose={vi.fn()}
        onRemove={onRemove}
        isRemoving={false}
        removeArmed={true}
        onArmRemove={onArmRemove}
      />
    );
    await userEvent.click(screen.getByText("Confirm Remove Connection"));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(
      <ConnectionDrawer
        profile={makeProfile()}
        onClose={onClose}
        onRemove={vi.fn()}
        isRemoving={false}
        removeArmed={false}
        onArmRemove={vi.fn()}
      />
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalled();
  });
});
