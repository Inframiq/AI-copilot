// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: {}, isResumeChanged: () => false }));

import { ProfileDifference } from "@/components/studio/canvas/ProfileDifference";
import { useResumeStore } from "@/stores/resume-store";

const PROFILE = { master_resume_id: "r1", summary: "Rephrased summary from the profile.", objective: null };

function mount(profile: object = PROFILE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["careerProfile"], profile);
  return render(<QueryClientProvider client={qc}><ProfileDifference field="summary" /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  useResumeStore.getState().resetStore();
  useResumeStore.setState({
    resumeId: "r1",
    content: { contact: { name: "", email: "" }, summary: "Summary the file printed.", experience: [], education: [], skills: [] },
  } as never);
  // No autosave reaching a server in these tests.
  useResumeStore.setState({ _triggerAutoSave: () => {} } as never);
});

describe("ProfileDifference", () => {
  // Uploading on the Profile kept the file's summary on the résumé and the
  // rephrased one on the profile, and the Builder showed only the first.
  it("offers the profile's summary when it differs, and changes nothing by itself", () => {
    mount();
    expect(screen.getByText("Rephrased summary from the profile.")).toBeInTheDocument();
    expect(useResumeStore.getState().content?.summary).toBe("Summary the file printed.");
  });

  it("applies the profile's summary only when the user picks it", () => {
    mount();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Use profile summary" })); });
    expect(useResumeStore.getState().content?.summary).toBe("Rephrased summary from the profile.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes away on Keep this one, until the profile's text changes", () => {
    const first = mount();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Keep this one" })); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(useResumeStore.getState().content?.summary).toBe("Summary the file printed.");
    first.unmount();

    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("comes back when the profile's summary changes after a keep", () => {
    localStorage.setItem("kripax.profile-difference.r1.summary", "An older profile summary.");
    mount();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("stays quiet when the two match but for spacing", () => {
    useResumeStore.setState({
      content: { ...useResumeStore.getState().content!, summary: "Rephrased  summary\nfrom the profile. " },
    });
    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never shows on a résumé that isn't the profile's master", () => {
    mount({ ...PROFILE, master_resume_id: "other" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never shows over a tailored draft", () => {
    useResumeStore.setState({ draftJdId: "jd1" } as never);
    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers nothing when the profile has no summary", () => {
    mount({ ...PROFILE, summary: "" });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
