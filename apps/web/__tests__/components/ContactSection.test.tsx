// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useResumeStore } from "@/stores/resume-store";
import { ContactSection } from "@/components/studio/canvas/ContactSection";

// The photo field reads its link through React Query.
const renderContact = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactSection />
    </QueryClientProvider>,
  );

function setContact(extra: Record<string, string>) {
  useResumeStore.setState({
    content: { contact: { name: "Jane", email: "j@x.com", ...extra }, experience: [], education: [], skills: [] },
    templateId: "ats_clean",
  } as never);
}

describe("the Builder's LinkedIn and GitHub fields", () => {
  beforeEach(() => setContact({}));

  it("puts a profile link in its standard form on leaving the field", () => {
    renderContact();
    const field = screen.getByLabelText("LinkedIn URL");
    fireEvent.change(field, { target: { value: "https://in.linkedin.com/in/jane-doe/?trk=x" } });
    fireEvent.blur(field);
    expect(useResumeStore.getState().content!.contact.linkedin).toBe("linkedin.com/in/jane-doe");
    expect(screen.queryByText(/Use your profile link/)).toBeNull();
  });

  // An uploaded résumé keeps whatever it held; the field says it needs a fix.
  it("flags a link that isn't a profile, and keeps it", () => {
    setContact({ github: "https://github.com/jane/kripax" });
    renderContact();
    const field = screen.getByLabelText("GitHub URL");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use your profile link: github.com/your-username")).toBeInTheDocument();
    fireEvent.blur(field);
    expect(useResumeStore.getState().content!.contact.github).toBe("https://github.com/jane/kripax");
  });
});

describe("the Builder's name, email and phone", () => {
  beforeEach(() => setContact({ name: "Ravi Kumar", email: "ravi@else.com", phone: "+1 555 010 0100", location: "Pune" }));

  function renderWithAccount(profileContact: Record<string, string>) {
    const client = new QueryClient();
    client.setQueryData(["careerProfile"], { contact: profileContact });
    client.setQueryData(["authUser"], { email: "asha@account.com" });
    return render(
      <QueryClientProvider client={client}>
        <ContactSection />
      </QueryClientProvider>,
    );
  }

  it("shows the account's, read-only, whatever the résumé holds", () => {
    renderWithAccount({ name: "Asha Rao", email: "asha@account.com", phone: "+91 98765 43210" });
    for (const [label, value] of [["Full Name", "Asha Rao"], ["Email", "asha@account.com"], ["Phone", "+91 98765 43210"]]) {
      const field = screen.getByLabelText(label) as HTMLInputElement;
      expect(field.value).toBe(value);
      expect(field.readOnly).toBe(true);
    }
    expect(screen.getByLabelText("Full Name")).toHaveAccessibleDescription("From the account. It cannot be changed.");
    expect(screen.getByLabelText("Phone")).toHaveAccessibleDescription("From the account. Change it in My Profile.");
    expect(screen.getByRole("link", { name: "My Profile" })).toHaveAttribute("href", "/profile");
    expect((screen.getByLabelText("Location") as HTMLInputElement).readOnly).toBe(false);
  });

  it("leaves a detail the account has none of to the résumé", () => {
    renderWithAccount({ name: "", email: "asha@account.com" });
    expect((screen.getByLabelText("Full Name") as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("+1 555 010 0100");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("asha@account.com");
  });
});
