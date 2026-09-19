// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TERMS_VERSION, PRIVACY_VERSION } from "../../lib/legal-versions";

const getPolicyAcceptance = vi.fn();
const acceptPolicies = vi.fn();
const signOut = vi.fn();
const push = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getPolicyAcceptance: () => getPolicyAcceptance(),
    acceptPolicies: (t: string, p: string) => acceptPolicies(t, p),
  },
}));
vi.mock("@/lib/supabase", () => ({ createBrowserClient: () => ({ auth: { signOut } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PolicyUpdatePrompt } from "../../components/legal/PolicyUpdatePrompt";

function renderPrompt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PolicyUpdatePrompt />
    </QueryClientProvider>,
  );
}

describe("PolicyUpdatePrompt", () => {
  beforeEach(() => {
    getPolicyAcceptance.mockReset();
    acceptPolicies.mockReset();
    signOut.mockReset();
    push.mockReset();
  });

  it("stays out of the way when the current versions are on record", async () => {
    getPolicyAcceptance.mockResolvedValue({
      terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, accepted_at: "2026-09-19T00:00:00Z",
    });
    renderPrompt();
    await waitFor(() => expect(getPolicyAcceptance).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks again after a policy changes, and records the new versions", async () => {
    getPolicyAcceptance.mockResolvedValue({
      terms_version: "2026-01-01", privacy_version: PRIVACY_VERSION, accepted_at: "2026-01-01T00:00:00Z",
    });
    acceptPolicies.mockResolvedValue(undefined);
    renderPrompt();
    expect(await screen.findByText("We've updated our terms")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "I agree" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(acceptPolicies).toHaveBeenCalledWith(TERMS_VERSION, PRIVACY_VERSION);
  });

  it("asks someone with no record at all", async () => {
    getPolicyAcceptance.mockResolvedValue({ terms_version: null, privacy_version: null, accepted_at: null });
    renderPrompt();
    expect(await screen.findByText("Please review our terms")).toBeTruthy();
  });

  it("lets someone who doesn't agree sign out instead", async () => {
    getPolicyAcceptance.mockResolvedValue({ terms_version: null, privacy_version: null, accepted_at: null });
    renderPrompt();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalled();
    expect(acceptPolicies).not.toHaveBeenCalled();
  });

  it("never locks anyone out when the check itself fails", async () => {
    getPolicyAcceptance.mockRejectedValue(new Error("API down"));
    renderPrompt();
    await waitFor(() => expect(getPolicyAcceptance).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
