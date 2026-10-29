// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ usePathname: () => "/jd" }));

const signOutHere = vi.fn().mockResolvedValue(undefined);
const leaveSignedOut = vi.fn();
vi.mock("@/lib/supabase", () => ({
  signOutHere: () => signOutHere(),
  leaveSignedOut: () => leaveSignedOut(),
  createBrowserClient: () => ({}),
}));

const getCareerProfile = vi.fn();
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: () => getCareerProfile() }));

// The signed link for a stored photo is fetched from storage; stand in for it.
vi.mock("@/lib/avatar-url", () => ({
  useAvatarSrc: (url: string | null) => (url ? `${url}?signed` : null),
  avatarPath: () => null,
  avatarSrcQuery: () => ({ queryKey: ["avatarSrc"], queryFn: () => null, enabled: false }),
}));

// The menu waits for the whole shell (lib/reveal), the credit balance too.
const getSubscription = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiClient: { getSubscription: () => getSubscription() } }));

const hasUnsavedWork = vi.fn(() => false);
vi.mock("@/lib/use-leave-warning", async (orig) => ({
  ...(await orig<typeof import("@/lib/use-leave-warning")>()),
  hasUnsavedWork: () => hasUnsavedWork(),
}));

import { AvatarMenu, initials } from "../../components/layout/AvatarMenu";

const PROFILE = {
  contact: { name: "Asha Rao", email: "asha@example.com" },
  photo_url: null as string | null,
};

function renderMenu(variant: "sidebar" | "rail" | "header" = "sidebar") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AvatarMenu variant={variant} />
    </QueryClientProvider>,
  );
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /account menu/i });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  return screen.getByRole("menu");
}

describe("initials", () => {
  it("takes the first and last name's first letters", () => {
    expect(initials("asha devi rao")).toBe("AR");
    expect(initials("Asha")).toBe("A");
    expect(initials("  ")).toBeNull();
    expect(initials(undefined)).toBeNull();
  });
});

describe("AvatarMenu", () => {
  beforeEach(() => {
    getCareerProfile.mockResolvedValue({ ...PROFILE });
    getSubscription.mockResolvedValue({ plan: "free", credits_remaining: 34, credits_allotment: 50, costs: {} });
    hasUnsavedWork.mockReturnValue(false);
    signOutHere.mockClear();
    leaveSignedOut.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the profile's initials when there is no photo", async () => {
    renderMenu("header");
    expect(await screen.findByText("AR")).toBeInTheDocument();
  });

  it("shows the profile photo when there is one", async () => {
    getCareerProfile.mockResolvedValue({ ...PROFILE, photo_url: "https://x.supabase.co/p.png" });
    const { container } = renderMenu("header");
    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).toBe("https://x.supabase.co/p.png?signed"),
    );
    expect(screen.queryByText("AR")).toBeNull();
  });

  it("names the user on the sidebar row", async () => {
    renderMenu("sidebar");
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("asha@example.com")).toBeInTheDocument();
  });

  it("opens My Profile · Account · Sign out, in that order", async () => {
    renderMenu();
    await screen.findByText("Asha Rao");
    const items = [...(await openMenu()).querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(["My Profile", "Account", "Sign out"]);
    expect(items[0]).toHaveAttribute("href", "/profile");
    expect(items[1]).toHaveAttribute("href", "/account");
  });

  it("closes on Escape and on a click outside", async () => {
    renderMenu();
    await openMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("signs out and leaves with a full page load", async () => {
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(leaveSignedOut).toHaveBeenCalledOnce());
    expect(signOutHere).toHaveBeenCalledOnce();
  });

  // Sign out is a click away on every page now, including a Profile or cover
  // letter with unsaved edits. Before, reaching it meant a link to /account,
  // which those pages already asked about.
  it("asks before signing out over unsaved work, and stays on Cancel", async () => {
    hasUnsavedWork.mockReturnValue(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(signOutHere).not.toHaveBeenCalled();
    expect(leaveSignedOut).not.toHaveBeenCalled();
  });

  it("signs out over unsaved work once the user agrees", async () => {
    hasUnsavedWork.mockReturnValue(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(leaveSignedOut).toHaveBeenCalledOnce());
  });

  it("doesn't ask when nothing is unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderMenu();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(leaveSignedOut).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
  });

  // Each part of the shell used to draw itself when its own request came
  // back: "My Profile" and a blank circle, then the name, then the balance.
  it("shows placeholder shapes, not a stand-in name, until the shell has loaded", async () => {
    let finish!: (v: unknown) => void;
    getSubscription.mockReturnValue(new Promise((r) => (finish = r)));
    renderMenu("sidebar");
    await waitFor(() => expect(getCareerProfile).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    const trigger = screen.getByRole("button", { name: /account menu/i });
    // The profile is in, but the balance isn't: still the placeholder.
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("My Profile")).toBeNull();
    expect(screen.queryByText("AR")).toBeNull();
    finish({ plan: "free", credits_remaining: 34, credits_allotment: 50, costs: {} });
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(trigger).toBeEnabled();
  });

  it("is the guided tour's profile target in the sidebar, never in the phone header", () => {
    const { unmount } = renderMenu("sidebar");
    expect(screen.getByRole("button", { name: /account menu/i })).toHaveAttribute("data-tour", "/profile");
    unmount();
    renderMenu("header");
    expect(screen.getByRole("button", { name: /account menu/i })).not.toHaveAttribute("data-tour");
  });
});
