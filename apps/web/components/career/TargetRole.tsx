"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

const KEY = ["careerPlan"];
/** Where the target role lived before it was saved to the account — moved
 * across (then cleared) the first time this loads with nothing saved. */
const OLD_LOCAL_KEY = "career-copilot-target-role";
const SAVE_AFTER_MS = 700;
const MAX = 120;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Career Path's "Target Role" — saved to the account a moment after you stop
 * typing, and straight away when you leave the field, so it's the same on
 * every device.
 */
export function TargetRole({ inputClassName }: { inputClassName: string }) {
  const queryClient = useQueryClient();
  const { data: plan, isSuccess } = useQuery({ queryKey: KEY, queryFn: () => apiClient.getCareerPlan() });
  // What's typed but not saved yet; null = show what's saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saved = plan?.target_role ?? "";
  const value = draft ?? saved;

  async function save(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const clean = next.trim();
    if (clean === saved.trim() && state !== "error") {
      setDraft(null);
      return;
    }
    setState("saving");
    try {
      const res = await apiClient.saveCareerPlan({ target_role: clean || null });
      queryClient.setQueryData(KEY, res);
      // Only clear the draft if nothing newer was typed while this saved.
      setDraft((d) => (d !== null && d.trim() === clean ? null : d));
      setState("saved");
    } catch {
      setState("error");
    }
  }

  // Move a target role typed before it was saved to the account.
  const migrated = useRef(false);
  useEffect(() => {
    if (!isSuccess || migrated.current) return;
    migrated.current = true;
    let local: string | null = null;
    try {
      local = localStorage.getItem(OLD_LOCAL_KEY);
    } catch {}
    if (!local?.trim()) return;
    if (plan?.target_role) {
      try { localStorage.removeItem(OLD_LOCAL_KEY); } catch {}
      return;
    }
    apiClient
      .saveCareerPlan({ target_role: local.trim().slice(0, MAX) })
      .then((res) => {
        queryClient.setQueryData(KEY, res);
        try { localStorage.removeItem(OLD_LOCAL_KEY); } catch {}
      })
      .catch(() => {});
  }, [isSuccess, plan, queryClient]);

  // "Saved" fades after a moment.
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <>
      <input
        value={value}
        maxLength={MAX}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => save(next), SAVE_AFTER_MS);
        }}
        onBlur={(e) => {
          // Show the start of a long role again, not wherever typing ended.
          e.currentTarget.scrollLeft = 0;
          if (draft !== null) save(draft);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        placeholder="Where to next?"
        aria-describedby="target-role-status"
        className={inputClassName}
      />
      <span id="target-role-status" role="status" className="absolute left-0 top-full mt-[2px] text-caption text-on-primary/70 whitespace-nowrap">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? (
          <button type="button" onClick={() => save(value)} className="underline text-on-primary">
            Couldn&apos;t save — try again
          </button>
        ) : null}
      </span>
    </>
  );
}
