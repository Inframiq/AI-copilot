// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient: { getResume: vi.fn() }, isResumeChanged: () => false }));

import { ProfileDifference, type DifferenceField } from "@/components/studio/canvas/ProfileDifference";
import { useResumeStore } from "@/stores/resume-store";

const PROFILE = {
  master_resume_id: "r1",
  headline: "Senior Backend Engineer",
  summary: "Rephrased summary from the profile.",
  objective: null,
  languages: [{ name: "English", level: "Native" }, { name: "Hindi", level: "" }],
  awards: ["Hackathon winner 2024"],
};
const UPLOADED = { id: "r1", original_file_name: "resume.pdf" };

function mount(field: DifferenceField = "summary", profile: object = PROFILE, resume: object = UPLOADED) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["careerProfile"], profile);
  qc.setQueryData(["resume", "r1"], resume);
  return render(<QueryClientProvider client={qc}><ProfileDifference field={field} /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  useResumeStore.getState().resetStore();
  useResumeStore.setState({
    resumeId: "r1",
    content: {
      contact: { name: "", email: "" }, headline: "Software Engineer",
      summary: "Summary the file printed.", languages: [{ name: "English", level: "Native" }],
      experience: [], education: [], skills: [],
    },
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

  it("applies the profile's version only when the user picks it", () => {
    mount();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Use profile version" })); });
    expect(useResumeStore.getState().content?.summary).toBe("Rephrased summary from the profile.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes away on Keep this one, until the profile's version changes", () => {
    const first = mount();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Keep this one" })); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(useResumeStore.getState().content?.summary).toBe("Summary the file printed.");
    first.unmount();

    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("comes back when the profile's version changes after a keep", () => {
    localStorage.setItem("kripax.profile-difference.r1.summary", "An older profile summary.");
    mount();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("offers the headline too", () => {
    mount("headline");
    expect(screen.getByRole("status", { name: "Profile Headline" })).toHaveTextContent("Senior Backend Engineer");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Use profile version" })); });
    expect(useResumeStore.getState().content?.headline).toBe("Senior Backend Engineer");
  });

  it("offers a list section as its items", () => {
    mount("languages");
    const offer = screen.getByRole("status", { name: "Profile Languages" });
    expect(offer).toHaveTextContent("English (Native)");
    expect(offer).toHaveTextContent("Hindi");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Use profile version" })); });
    expect(useResumeStore.getState().content?.languages).toEqual(PROFILE.languages);
  });

  it("offers a section the résumé doesn't have at all", () => {
    mount("awards");
    expect(screen.getByRole("status", { name: "Profile Awards" })).toHaveTextContent("Hackathon winner 2024");
  });

  it("stays quiet when the two match but for spacing", () => {
    useResumeStore.setState({
      content: { ...useResumeStore.getState().content!, summary: "Rephrased  summary\nfrom the profile. " },
    });
    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // The user's call: only a résumé that came from an uploaded file.
  it("never shows on a master résumé that wasn't uploaded", () => {
    mount("summary", PROFILE, { id: "r1", original_file_name: null });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never shows on a résumé that isn't the profile's master", () => {
    mount("summary", { ...PROFILE, master_resume_id: "other" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never shows over a tailored draft", () => {
    useResumeStore.setState({ draftJdId: "jd1" } as never);
    mount();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers nothing when the profile's section is empty", () => {
    mount("summary", { ...PROFILE, summary: "" });
    expect(screen.queryByRole("status")).toBeNull();
    mount("objective");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
