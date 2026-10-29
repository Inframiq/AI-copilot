// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TERMS_VERSION, PRIVACY_VERSION } from "../../lib/legal-versions";

const getPolicyAcceptance = vi.fn();
const acceptPolicies = vi.fn();
const signOut = vi.fn();
const leave = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getPolicyAcceptance: () => getPolicyAcceptance(),
    acceptPolicies: (t: string, p: string) => acceptPolicies(t, p),
  },
}));
vi.mock("@/lib/supabase", () => ({ createBrowserClient: () => ({ auth: { signOut } }), signOutHere: () => signOut(), leaveSignedOut: () => leave() }));

import { PolicyUpdatePrompt } from "../../components/legal/PolicyUpdatePrompt";
import { reportPolicyRefusal, usePolicyStore } from "../../stores/policy-store";
import { act } from "@testing-library/react";

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
    leave.mockReset();
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
    await waitFor(() => expect(leave).toHaveBeenCalled());
    expect(signOut).toHaveBeenCalled();
    expect(acceptPolicies).not.toHaveBeenCalled();
  });

  it("never locks anyone out when the check itself fails", async () => {
    getPolicyAcceptance.mockRejectedValue(new Error("API down"));
    renderPrompt();
    await waitFor(() => expect(getPolicyAcceptance).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // The server refuses a feature that needs newer terms (app/core/policy.py).
  // The prompt then checks again, so it asks even if its first check failed
  // or a click beat it.
  it("asks when the server refuses a feature for want of agreement, even after a failed first check", async () => {
    usePolicyStore.setState({ refusals: 0 });
    getPolicyAcceptance.mockRejectedValueOnce(new Error("API down"));
    renderPrompt();
    await waitFor(() => expect(getPolicyAcceptance).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    getPolicyAcceptance.mockResolvedValue({ terms_version: "2026-01-01", privacy_version: "2026-01-01", accepted_at: null });
    act(() => reportPolicyRefusal({ code: "policy_update_required", message: "Agree to the updated Terms" }));
    expect(await screen.findByText("We've updated our terms")).toBeTruthy();
  });

  it("ignores other refusals", () => {
    usePolicyStore.setState({ refusals: 0 });
    reportPolicyRefusal("Admin access required");
    reportPolicyRefusal({ code: "something_else" });
    expect(usePolicyStore.getState().refusals).toBe(0);
  });
});
