// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FormatToolbar } from "../../components/studio/FormatToolbar";

// jsdom implements neither, and they are the whole mechanism.
const exec = vi.fn(() => true);
const state = vi.fn((_cmd: string) => false);

beforeEach(() => {
  exec.mockClear();
  state.mockClear();
  Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
  Object.defineProperty(document, "queryCommandState", { value: state, configurable: true });
});

describe("FormatToolbar", () => {
  it("offers bold, italic and underline", () => {
    render(<FormatToolbar />);
    for (const name of ["Bold", "Italic", "Underline"]) {
      expect(screen.getByRole("button", { name: new RegExp(name, "i") })).toBeTruthy();
    }
  });

  it("applies the command for the button pressed", () => {
    render(<FormatToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /italic/i }));
    expect(exec).toHaveBeenCalledWith("italic");
  });

  it("does not steal focus from the text being edited", () => {
    // Without preventDefault on mousedown the caret is gone before the click
    // lands, and execCommand has no selection to act on.
    render(<FormatToolbar />);
    const event = fireEvent.mouseDown(screen.getByRole("button", { name: /bold/i }));
    expect(event).toBe(false);
  });

  it("shows a command as active when the caret sits inside it", async () => {
    state.mockImplementation((cmd: string) => cmd === "bold" ? true : false);
    render(<FormatToolbar />);
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(screen.getByRole("button", { name: /bold/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /italic/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("re-reads state after a command, so the button toggles off", async () => {
    render(<FormatToolbar />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /bold/i }));
    });
    expect(state).toHaveBeenCalledWith("bold");
  });
});
