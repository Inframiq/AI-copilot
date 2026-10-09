"use client";
import { useEffect, useState } from "react";
import { CloudSlash, CloudCheck } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";

/**
 * Says so when the device loses its connection — a phone on patchy signal,
 * mostly. Before, nothing did: an edit made offline failed its autosave
 * quietly, a page's lists fell back to empty, and nothing retried once the
 * signal returned.
 *
 * Back online, it saves any résumé edit that is still waiting (data queries
 * refetch on reconnect by themselves) and says so for a moment.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    let hide: ReturnType<typeof setTimeout> | undefined;
    const goOffline = () => {
      clearTimeout(hide);
      setBackOnline(false);
      setOffline(true);
    };
    const goOnline = () => {
      setOffline(false);
      setBackOnline(true);
      hide = setTimeout(() => setBackOnline(false), 3000);
      const resume = useResumeStore.getState();
      // A draft is saved only by Save to JD; anything else pending goes now.
      if (resume.isDirty && !resume.draftJdId) resume.saveNow().catch(() => {});
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      clearTimeout(hide);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline && !backOnline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-md pt-[max(6px,env(safe-area-inset-top))]`}
    >
      <p
        className={`pointer-events-auto flex items-center gap-xs rounded-full px-md py-xs text-label-sm font-semibold shadow-lg ${
          offline ? "bg-inverse-surface text-inverse-on-surface" : "bg-success text-on-success"
        }`}
      >
        {offline ? (
          <>
            <CloudSlash size={16} weight="fill" className="shrink-0" />
            You&apos;re offline — changes won&apos;t save until you reconnect.
          </>
        ) : (
          <>
            <CloudCheck size={16} weight="fill" className="shrink-0" />
            Back online
          </>
        )}
      </p>
    </div>
  );
}
