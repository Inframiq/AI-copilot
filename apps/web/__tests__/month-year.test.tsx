// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { endsBeforeStart, isPresent, isStandardDate, parseMonthYear, tidyDate } from "@/lib/month-year";
import { MonthYearField } from "@/components/ui/MonthYearPicker";
import { ResumeCanvas } from "@/components/studio/ResumeCanvas";

describe("reading typed dates", () => {
  it.each([
    ["Jan 2022", "Jan 2022"],
    ["January 2022", "Jan 2022"],
    ["jan. 2022", "Jan 2022"],
    ["Sept 2021", "Sep 2021"],
    ["June, 2020", "Jun 2020"],
    ["Mar '19", "Mar 2019"],
    ["01/2022", "Jan 2022"],
    ["6-2021", "Jun 2021"],
    ["2021-06", "Jun 2021"],
    ["2021/12", "Dec 2021"],
    ["2022", "2022"],
    ["  present ", "Present"],
    ["Currently", "Present"],
    ["Till date", "Present"],
    ["", ""],
  ])("%j → %j", (typed, saved) => {
    expect(tidyDate(typed)).toBe(saved);
    expect(isStandardDate(saved)).toBe(true);
  });

  it.each(["sometime in 2020", "13/2022", "Smarch 2020", "Q3 2021", "20222"])("leaves %j as typed, and says it isn't a date", (typed) => {
    expect(tidyDate(typed)).toBe(typed);
    expect(isStandardDate(typed)).toBe(false);
  });

  it("reads two-digit years as this century unless that's far in the future", () => {
    expect(parseMonthYear("Jan 05")).toEqual({ year: 2005, month: 0 });
    expect(parseMonthYear("Jan 98")).toEqual({ year: 1998, month: 0 });
  });

  it("knows an end that comes before its start", () => {
    expect(endsBeforeStart("Mar 2022", "Jan 2022")).toBe(true);
    expect(endsBeforeStart("Mar 2022", "Mar 2022")).toBe(false);
    expect(endsBeforeStart("Mar 2022", "2021")).toBe(true);
    // A year alone is its whole year: neither of these is backwards.
    expect(endsBeforeStart("2022", "Mar 2022")).toBe(false);
    expect(endsBeforeStart("Jun 2022", "2022")).toBe(false);
    expect(endsBeforeStart("Mar 2022", "Present")).toBe(false);
    expect(endsBeforeStart("", "Jan 2020")).toBe(false);
    expect(isPresent("Now")).toBe(true);
  });
});

function Field({ initial = "", start, allowPresent, onSaved = () => {} }: {
  initial?: string; start?: string; allowPresent?: boolean; onSaved?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return <MonthYearField label="End" value={value} start={start} allowPresent={allowPresent} onChange={(v) => { setValue(v); onSaved(v); }} />;
}

describe("the month-year picker", () => {
  it("picks the year, then a month, and saves \"Mar 2021\"", async () => {
    const saved = vi.fn();
    render(<Field onSaved={saved} />);
    await userEvent.click(screen.getByRole("button", { name: "End: not set" }));
    const sheet = screen.getByRole("dialog", { name: "End date" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2021");
    await userEvent.click(screen.getByRole("button", { name: "Mar 2021" }));
    expect(saved).toHaveBeenCalledWith("Mar 2021");
    expect(sheet).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End: Mar 2021" })).toBeInTheDocument();
  });

  it("won't take an end before the start", async () => {
    render(<Field start="Jun 2022" />);
    await userEvent.click(screen.getByRole("button", { name: /^End/ }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Year" }), "2022");
    expect(screen.getByRole("button", { name: "May 2022" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Jun 2022" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "2021" })).toBeDisabled();
  });

  it("offers year only, Present where an end can be open, and Clear", async () => {
    const saved = vi.fn();
    render(<Field initial="Jan 2020" allowPresent onSaved={saved} />);
    await userEvent.click(screen.getByRole("button", { name: /^End/ }));
    await userEvent.click(screen.getByRole("button", { name: "2020 only" }));
    expect(saved).toHaveBeenLastCalledWith("2020");
    await userEvent.click(screen.getByRole("button", { name: /^End/ }));
    await userEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(saved).toHaveBeenLastCalledWith("Present");
    await userEvent.click(screen.getByRole("button", { name: /^End/ }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(saved).toHaveBeenLastCalledWith("");
  });

  it("shows a date typed before the picker in the standard form, and flags text that isn't one", () => {
    const { unmount } = render(<Field initial="January 2022" />);
    expect(screen.getByRole("button", { name: "End: Jan 2022" })).not.toHaveAttribute("aria-invalid");
    unmount();
    render(<Field initial="sometime in 2020" />);
    expect(screen.getByRole("button", { name: /^End/ })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Not a date the résumé can read. Pick one.")).toBeInTheDocument();
  });

  it("flags an end left before a start that moved", () => {
    render(<Field initial="Jan 2020" start="Mar 2021" />);
    expect(screen.getByText("Ends before it starts.")).toBeInTheDocument();
  });
});

describe("dates in the Studio preview", () => {
  const HTML = `<div><span data-field="experience.0.title">Engineer</span>
    <span data-field="experience.0.start">Jan 2021</span> – <span data-field="experience.0.end">Present</span></div>`;

  it("open the picker instead of being typed into", async () => {
    const onEditDate = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={() => {}} onEditDate={onEditDate} />);
    const host = container.querySelector("[data-canvas]") as HTMLElement;
    const root = host.shadowRoot ?? host;
    const start = root.querySelector<HTMLElement>('[data-field="experience.0.start"]')!;
    expect(start.getAttribute("contenteditable")).toBe("false");
    expect(start.getAttribute("role")).toBe("button");
    start.click();
    expect(onEditDate).toHaveBeenCalledWith({ path: "experience.0.start", value: "Jan 2021" });
    // Other fields are still typed into in place.
    expect(root.querySelector('[data-field="experience.0.title"]')!.getAttribute("contenteditable")).not.toBe("false");
  });
});
