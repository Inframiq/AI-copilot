// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("jd=jd-1"),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getQuestions: vi.fn().mockResolvedValue([]),
    getMyQuestions: vi.fn().mockResolvedValue([]),
    getSubscription: vi.fn().mockResolvedValue({ costs: {} }),
  },
}));

import InterviewPracticePage from "../app/(app)/interview/[sessionId]/page";

describe("practice page", () => {
  it("a link to a set that was replaced leads back to the job's current questions", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <InterviewPracticePage params={Promise.resolve({ sessionId: "old-run" })} />
        </QueryClientProvider>,
      );
    });

    expect(await screen.findByText("No questions here")).toBeInTheDocument();
    expect(screen.getByText(/replaced by a newer one, or removed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open the Interview Center" }));
    expect(push).toHaveBeenCalledWith("/interview?jd=jd-1");
  });
});
