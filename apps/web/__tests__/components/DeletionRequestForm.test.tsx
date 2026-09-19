// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sent: unknown[] = [];
let failWith: Error | null = null;
vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    submitDeletionRequest: (input: unknown) => {
      sent.push(input);
      return failWith ? Promise.reject(failWith) : Promise.resolve();
    },
  };
});

import { DeletionRequestForm } from "../../components/legal/DeletionRequestForm";
import { ApiError } from "@/lib/api-client";

describe("DeletionRequestForm", () => {
  beforeEach(() => {
    sent.length = 0;
    failWith = null;
  });

  it("sends the request and says what happens next", async () => {
    const user = userEvent.setup();
    render(<DeletionRequestForm />);
    await user.type(screen.getByLabelText("Your email address"), "jane@example.com");
    await user.click(screen.getByLabelText(/I don't use KripaX/));
    await user.type(screen.getByLabelText(/What should we delete/), "My details in a contact list");
    await user.click(screen.getByRole("button", { name: "Send deletion request" }));

    expect(sent).toEqual([{
      email: "jane@example.com",
      name: "",
      requester_type: "not_a_user",
      details: "My details in a contact list",
      website: "",
    }]);
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing is deleted until you reply");
  });

  it("keeps the bot trap out of reach of people and screen readers", () => {
    render(<DeletionRequestForm />);
    const trap = screen.getByLabelText("Website", { selector: "input" });
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("points to email when rate limited", async () => {
    failWith = new ApiError(429, "Too many");
    const user = userEvent.setup();
    render(<DeletionRequestForm />);
    await user.type(screen.getByLabelText("Your email address"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Send deletion request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("support@inframiq.com");
  });
});
