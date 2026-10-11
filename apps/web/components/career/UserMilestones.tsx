"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Circle, Plus, X, CircleNotch } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import type { CareerMilestone } from "@career-copilot/types";

const KEY = ["careerMilestones"];
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;

const errorText = (err: unknown, fallback: string) =>
  typeof navigator !== "undefined" && !navigator.onLine
    ? "You're offline — nothing was saved. Try again once you're back online."
    : err instanceof Error && err.message && !/^\d+$/.test(err.message)
      ? err.message
      : fallback;

/**
 * The milestones the user adds to Career Path's roadmap, under the built-in
 * ones (which the page works out from activity). Rendered as more rows of
 * the same timeline, then "Add milestone".
 */
export function UserMilestones() {
  const queryClient = useQueryClient();
  const { data: milestones = [], isLoading } = useQuery<CareerMilestone[]>({
    queryKey: KEY,
    queryFn: () => apiClient.getCareerMilestones(),
  });

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) titleRef.current?.focus();
  }, [adding]);

  const add = useMutation({
    mutationFn: () => apiClient.addCareerMilestone({ title: title.trim(), description: description.trim() || null }),
    onSuccess: (m) => {
      queryClient.setQueryData<CareerMilestone[]>(KEY, (list) => [...(list ?? []), m]);
      setTitle("");
      setDescription("");
      setAdding(false);
    },
    onError: (err) => setFormError(errorText(err, "Couldn't add that milestone. Try again.")),
  });

  async function toggle(m: CareerMilestone) {
    setRowError(null);
    const set = (done: boolean) =>
      queryClient.setQueryData<CareerMilestone[]>(KEY, (list) => list?.map((x) => (x.id === m.id ? { ...x, done } : x)));
    set(!m.done);
    try {
      await apiClient.updateCareerMilestone(m.id, { done: !m.done });
    } catch (err) {
      set(m.done);
      setRowError({ id: m.id, message: errorText(err, "Couldn't save that. Try again.") });
    }
  }

  async function remove(m: CareerMilestone) {
    setRowError(null);
    const before = queryClient.getQueryData<CareerMilestone[]>(KEY);
    queryClient.setQueryData<CareerMilestone[]>(KEY, (list) => list?.filter((x) => x.id !== m.id));
    try {
      await apiClient.deleteCareerMilestone(m.id);
    } catch (err) {
      queryClient.setQueryData(KEY, before);
      setRowError({ id: m.id, message: errorText(err, "Couldn't delete that milestone. Try again.") });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setFormError("Give the milestone a name.");
      return;
    }
    setFormError(null);
    add.mutate();
  }

  function cancel() {
    setAdding(false);
    setTitle("");
    setDescription("");
    setFormError(null);
  }

  return (
    <>
      {!isLoading &&
        milestones.map((m) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            error={rowError?.id === m.id ? rowError.message : null}
            onToggle={() => toggle(m)}
            onDelete={() => remove(m)}
          />
        ))}

      {adding ? (
        <form
          onSubmit={submit}
          className="ml-[44px] flex flex-col gap-sm p-md rounded-xl border border-primary/25 bg-primary/5"
        >
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm text-on-surface-variant">Milestone</span>
            <input
              ref={titleRef}
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cancel()}
              placeholder="e.g. Get AWS Solutions Architect certified"
              className="px-md py-sm rounded-lg border border-outline-variant/50 bg-surface text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm text-on-surface-variant">
              Details <span className="opacity-70">(optional)</span>
            </span>
            <textarea
              value={description}
              maxLength={DESCRIPTION_MAX}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && cancel()}
              placeholder="What done looks like, or a target date"
              className="px-md py-sm rounded-lg border border-outline-variant/50 bg-surface text-body-sm text-on-surface resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </label>
          {formError && (
            <p role="alert" className="text-caption text-error">
              {formError}
            </p>
          )}
          <div className="flex gap-sm justify-end">
            <button
              type="button"
              onClick={cancel}
              className="px-md py-xs rounded-lg border border-outline-variant/40 text-label-sm text-on-surface hover:bg-surface-container"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={add.isPending}
              className="inline-flex items-center gap-xs px-md py-xs rounded-lg bg-primary text-on-primary text-label-sm shadow-sm hover:shadow-md disabled:opacity-60"
            >
              {add.isPending && <CircleNotch size={14} className="animate-spin motion-reduce:animate-none" />}
              Add milestone
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start ml-[44px] flex items-center gap-sm text-label-md text-primary hover:text-primary-container transition-colors py-sm -mb-sm"
        >
          <Plus size={18} /> Add milestone
        </button>
      )}
    </>
  );
}

function MilestoneRow({
  milestone: m,
  error,
  onToggle,
  onDelete,
}: {
  milestone: CareerMilestone;
  error: string | null;
  onToggle: () => void;
  onDelete: () => void;
}) {
  // Delete asks once more, in place — a stray tap on a phone shouldn't lose it.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <div className="flex items-start gap-md pl-xs">
      <button
        type="button"
        role="checkbox"
        aria-checked={m.done}
        aria-label={`${m.done ? "Mark not done" : "Mark done"}: ${m.title}`}
        onClick={onToggle}
        className={`mt-xs shrink-0 relative before:absolute before:-inset-[6px] before:content-[''] rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          m.done ? "text-success-accent" : "text-outline-variant hover:text-primary"
        }`}
      >
        {m.done ? <CheckCircle size={24} weight="fill" /> : <Circle size={24} />}
      </button>
      <div
        className={`flex-1 min-w-0 p-md rounded-xl border transition-all ${
          m.done ? "bg-surface-container border-outline-variant/10 opacity-70" : "bg-surface-container-lowest border-outline-variant/20"
        }`}
      >
        <div className="flex items-start justify-between gap-sm">
          <p
            className={`min-w-0 break-words text-label-md font-semibold ${
              m.done ? "text-on-surface-variant line-through" : "text-on-surface"
            }`}
          >
            {m.title}
          </p>
          <div className="flex items-center gap-xs shrink-0">
            {m.done && (
              <span className="text-caption text-success-accent bg-success-accent/10 px-sm py-xs pill rounded-full">Done</span>
            )}
            {confirming ? (
              <button
                type="button"
                onClick={onDelete}
                className="px-sm py-xs -my-xs rounded-full bg-error text-on-error text-caption"
              >
                Delete?
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Delete milestone: ${m.title}`}
                onClick={() => setConfirming(true)}
                className="relative before:absolute before:-inset-[6px] before:content-[''] p-xs -m-xs rounded-full text-on-surface-variant hover:text-error"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {m.description && <p className="mt-xs text-body-sm text-on-surface-variant break-words">{m.description}</p>}
        {error && (
          <p role="alert" className="mt-xs text-caption text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
