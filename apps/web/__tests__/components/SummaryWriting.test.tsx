// @vitest-environment jsdom
// The professional summary: the one every tailoring run writes (review
// card), and the Builder's "Write summary" button (3 credits).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SummaryCard } from "@/components/studio/review/SummaryCard";
import { SummarySection } from "@/components/studio/canvas/SummarySection";
import { WRITE_SUMMARY_CREDITS } from "@/components/resume/SummaryWriter";
import { SummaryCard as ProfileSummaryCard } from "@/components/profile/ProfileSections";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const card = (over: Partial<Parameters<typeof SummaryCard>[0]> = {}) => {
  const props = {
    original: "Java engineer.",
    tailored: "Software Engineer with 7+ years in backend Java.",
    decision: undefined,
    busy: null,
    error: null,
    prompt: "",
    setPrompt: vi.fn(),
    onDecide: vi.fn(),
    onRewrite: vi.fn(),
    ...over,
  } as Parameters<typeof SummaryCard>[0];
  render(<SummaryCard {...props} />);
  return props;
};

describe("review: the summary tailoring wrote", () => {
  it("offers it beside the user's own", () => {
    card();
    expect(screen.getByRole("button", { name: "For this job" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Your original" })).toBeTruthy();
    expect(screen.getByText(/7\+ years in backend Java/)).toBeTruthy();
  });

  it("names the other side None when the résumé had no summary", () => {
    card({ original: "" });
    expect(screen.getByRole("button", { name: "None" })).toBeTruthy();
  });

  it("says why a flagged one started off", () => {
    card({ decision: "reject", flags: ["has a number that isn't on the résumé: 450"] });
    expect(screen.getByTestId("summary-flags").textContent).toMatch(
      /The summary for this job is off because it has a number that isn't on the résumé: 450/,
    );
    expect(screen.getByText("Java engineer.")).toBeTruthy();
  });

  it("asks for a check when the user switches a flagged one on", () => {
    card({ decision: "accept", flags: ["names Docker, which the résumé doesn't show"] });
    expect(screen.getByTestId("summary-flags").textContent).toMatch(/Check before you keep this — it names Docker/);
  });
});

describe("review: Humanize and the custom box use the summary writer", () => {
  it("say they cost what the writer costs", () => {
    card();
    expect(screen.getByRole("button", { name: /Humanize/ }).getAttribute("title")).toContain(
      `uses ${WRITE_SUMMARY_CREDITS} credits`,
    );
    expect(screen.getByRole("button", { name: `Apply custom rewrite — uses ${WRITE_SUMMARY_CREDITS} credits` })).toBeTruthy();
  });

  it("the review never sends the summary to the one-call rewrite", () => {
    const shell = readFileSync(join(process.cwd(), "components/builder/ReviewShell.tsx"), "utf8");
    expect(shell).not.toMatch(/field:s*"summary"/);
  });
});

describe("Builder: Generate / Regenerate with KripaX", () => {
  const RESUME = {
    contact: { name: "A" },
    summary: "My own words.",
    experience: [{ title: "Engineer", company: "Acme", bullets: ["Built APIs."] }],
    education: [],
    skills: [],
  };

  beforeEach(() => {
    useResumeStore.setState({ content: RESUME } as never);
    vi.restoreAllMocks();
  });

  const renderSection = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SummarySection />
      </QueryClientProvider>,
    );

  describe("a summary past 100 words", () => {
    const long = Array.from({ length: 106 }, (_, i) => `word${i}`).join(" ");

    it("shows a warning to rephrase it with KripaX or edit it, never that it's saved as it is", () => {
      useResumeStore.setState({ content: { ...RESUME, summary: long }, isDirty: true, saveError: null } as never);
      renderSection();
      expect(screen.getByText("106 / 100 words")).toBeTruthy();
      expect(screen.getByText(
        "A professional summary holds up to 100 words; this one has 106. Rephrase it with KripaX or edit it to 100 or fewer.",
      )).toBeTruthy();
      expect(screen.queryByText(/saves as it is/)).toBeNull();
    });

    it("keeps every word typed past the limit", () => {
      useResumeStore.setState({ content: { ...RESUME, summary: "" } } as never);
      renderSection();
      fireEvent.change(screen.getByPlaceholderText(/professional summary/i), { target: { value: long } });
      expect(useResumeStore.getState().content?.summary).toBe(long);
    });
  });

  it("checks the summary in the box against the guide, for free", async () => {
    const check = vi.spyOn(apiClient, "checkSummary").mockResolvedValue({
      problems: ["uses filler words: passionate, seasoned"], min_words: 50, max_words: 65,
    });
    const write = vi.spyOn(apiClient, "writeSummary");
    renderSection();
    await waitFor(() => expect(screen.getByTestId("summary-guide")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByTestId("summary-guide").textContent).toBe(
      "Summary guide: this summary uses filler words: passionate, seasoned.",
    );
    expect(check).toHaveBeenCalledWith(RESUME, "My own words.");
    expect(write).not.toHaveBeenCalled();
  });

  it("shows no guide note when the summary keeps to it or the check can't be reached", async () => {
    const check = vi.spyOn(apiClient, "checkSummary").mockRejectedValue(new Error("offline"));
    renderSection();
    await waitFor(() => expect(check).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.queryByTestId("summary-guide")).toBeNull();
  });

  it("says what it costs", () => {
    renderSection();
    expect(screen.getByRole("button", { name: /regenerate with kripax/i }).textContent).toMatch(/uses 3 credits/);
  });

  it("shows the draft and changes nothing until Use this", async () => {
    const spy = vi.spyOn(apiClient, "writeSummary").mockResolvedValue({ summary: "Engineer building APIs.", problems: [] });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /regenerate with kripax/i }));
    await waitFor(() => expect(screen.getByLabelText("Suggested summary")).toBeTruthy());
    expect(spy).toHaveBeenCalledWith(RESUME);
    expect(useResumeStore.getState().content?.summary).toBe("My own words.");
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(useResumeStore.getState().content?.summary).toBe("Engineer building APIs.");
    expect(screen.queryByLabelText("Suggested summary")).toBeNull();
  });

  it("Keep mine leaves the user's summary", async () => {
    vi.spyOn(apiClient, "writeSummary").mockResolvedValue({ summary: "Other.", problems: [] });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /regenerate with kripax/i }));
    await waitFor(() => screen.getByRole("button", { name: "Keep mine" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(useResumeStore.getState().content?.summary).toBe("My own words.");
  });

  it("shows a draft's problems before the user uses it", async () => {
    vi.spyOn(apiClient, "writeSummary").mockResolvedValue({
      summary: "Engineer with 9 years.", problems: ["says 9 years of experience, more than the job dates on the résumé add up to"],
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /regenerate with kripax/i }));
    await waitFor(() => screen.getByTestId("write-summary-problems"));
    expect(screen.getByTestId("write-summary-problems").textContent).toMatch(/Check before you use this — it says 9 years/);
  });

  it("shows the server's reason when it fails", async () => {
    vi.spyOn(apiClient, "writeSummary").mockRejectedValue(new Error("Couldn't write a summary just now — your credits were returned. Try again."));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /regenerate with kripax/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/credits were returned/));
  });

  it("charges what the server charges", () => {
    const credits = readFileSync(join(__dirname, "../../../api/app/core/credits.py"), "utf8");
    expect(Number(/"write_summary": (\d+)/.exec(credits)?.[1])).toBe(WRITE_SUMMARY_CREDITS);
  });
});

describe("Profile: summary with KripaX", () => {
  const source = { contact: {}, experience: [{ title: "Engineer", company: "Acme", bullets: ["Built APIs."] }] } as never;
  const renderCard = (value: string, onChange = vi.fn()) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProfileSummaryCard value={value} onChange={onChange} writeFrom={() => source} />
      </QueryClientProvider>,
    );
    return onChange;
  };

  beforeEach(() => vi.restoreAllMocks());

  it("asks for a summary when there is none", () => {
    renderCard("");
    expect(screen.getByTestId("summary-missing").textContent).toMatch(/No professional summary yet/);
    expect(screen.getByRole("button", { name: /generate with kripax/i }).textContent).toMatch(/uses 3 credits/);
  });

  it("offers Regenerate when there is one", () => {
    renderCard("Engineer building APIs.");
    expect(screen.queryByTestId("summary-missing")).toBeNull();
    expect(screen.getByRole("button", { name: /regenerate with kripax/i })).toBeTruthy();
  });

  it("writes from the form as it is now and fills the box on Use this", async () => {
    const spy = vi.spyOn(apiClient, "writeSummary").mockResolvedValue({ summary: "Engineer with APIs.", problems: [] });
    const onChange = renderCard("");
    fireEvent.click(screen.getByRole("button", { name: /generate with kripax/i }));
    await waitFor(() => screen.getByRole("button", { name: "Use this" }));
    expect(spy).toHaveBeenCalledWith(source);
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onChange).toHaveBeenCalledWith("Engineer with APIs.");
  });

  it("has no button where the page gives nothing to write from", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProfileSummaryCard value="" onChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: /with kripax/i })).toBeNull();
  });
});
