// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileCard } from "../../components/networking/ProfileCard";
import type { Profile } from "../../lib/networking-client";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "user-1",
    display_name: "Jane Doe",
    headline: "Senior Engineer",
    bio: null,
    location: "San Francisco, CA",
    skills: ["React", "TypeScript", "Node", "GraphQL", "AWS"],
    open_to_work: false,
    available_for: [],
    linkedin_url: null,
    github_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ProfileCard", () => {
  it("renders name, headline, location, and capped skills", () => {
    render(<ProfileCard profile={makeProfile()} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
    expect(screen.getByText("San Francisco, CA")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument(); // 5 skills, caps at 4
  });

  it("shows an Open to Work badge when applicable", () => {
    render(<ProfileCard profile={makeProfile({ open_to_work: true })} />);
    expect(screen.getByText("Open to Work")).toBeInTheDocument();
  });

  it("shows no connect affordance when connectStatus is undefined (My Network mode)", () => {
    render(<ProfileCard profile={makeProfile()} />);
    expect(screen.queryByText("Connect")).not.toBeInTheDocument();
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
  });

  it("calls onConnect when Connect is clicked, without triggering onClick", async () => {
    const onConnect = vi.fn();
    const onClick = vi.fn();
    render(
      <ProfileCard profile={makeProfile()} connectStatus="none" onConnect={onConnect} onClick={onClick} />
    );
    await userEvent.click(screen.getByText("Connect"));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a Cancel affordance when pending, and Connected checkmark when accepted", () => {
    const { rerender } = render(<ProfileCard profile={makeProfile()} connectStatus="pending" />);
    expect(screen.getByText(/Pending/)).toBeInTheDocument();

    rerender(<ProfileCard profile={makeProfile()} connectStatus="accepted" />);
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
  });
});
