// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const leaveMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAdminUsers: vi.fn().mockResolvedValue([]),
    getFeedback: vi.fn().mockResolvedValue([]),
    getDeletionRequests: vi.fn().mockResolvedValue([]),
    updateUserPlan: vi.fn(),
    refreshUserCredits: vi.fn(),
    updateDeletionRequest: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/supabase", () => ({
  signOutHere: () => signOutMock(),
  leaveSignedOut: () => leaveMock(),
}));

import AdminPage from "../app/admin/page";

describe("Admin page", () => {
  // Admin-only accounts are kept off every other page, the Account page
  // included, so the admin page has to offer its own way out.
  it("signs out and leaves with a full page load", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AdminPage />
      </QueryClientProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledTimes(1));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock.mock.invocationCallOrder[0]).toBeLessThan(leaveMock.mock.invocationCallOrder[0]);
  });
});
