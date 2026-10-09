// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { useResumeStore } from "@/stores/resume-store";

function goOffline() {
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
}
function goOnline() {
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

describe("OfflineBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useResumeStore.getState().resetStore();
  });
  afterEach(() => vi.useRealTimers());

  it("shows nothing while connected", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so when the connection drops, and that changes won't save", () => {
    render(<OfflineBanner />);
    goOffline();
    expect(screen.getByRole("status")).toHaveTextContent(/offline — changes won.t save until you reconnect/i);
  });

  it("says it is back, saves a pending résumé edit, then gets out of the way", async () => {
    const saveNow = vi.fn(async () => {});
    useResumeStore.setState({ isDirty: true, draftJdId: null, saveNow } as never);
    render(<OfflineBanner />);
    goOffline();
    goOnline();
    expect(screen.getByRole("status")).toHaveTextContent(/back online/i);
    expect(saveNow).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never saves an unsaved tailored draft on reconnect — only Save to JD does", () => {
    const saveNow = vi.fn(async () => {});
    useResumeStore.setState({ isDirty: true, draftJdId: "jd-1", saveNow } as never);
    render(<OfflineBanner />);
    goOffline();
    goOnline();
    expect(saveNow).not.toHaveBeenCalled();
  });
});
