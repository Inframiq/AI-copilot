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
