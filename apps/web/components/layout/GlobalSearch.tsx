"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  MagnifyingGlass,
  FileText,
  FileDashed,
  EnvelopeSimple,
  MicrophoneStage,
  ArrowRight,
  type Icon,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { APP_NAV } from "@/lib/nav";
import type { CoverLetter, JobDescription, PrepQuestionWithJdOut, Resume } from "@career-copilot/types";

interface Hit {
  key: string;
  group: string;
  label: string;
  /** Also searched, ranked below a label match — a job's own text, since
   * JD titles are often just "JD4". */
  body?: string;
  hint?: string;
  href: string;
  icon: Icon;
}

const PER_GROUP = 5;

/** Every word of the query appears in the text — "back acme" finds
 * "Senior Backend Engineer — Acme". Earlier matches rank higher. */
function score(text: string, words: string[]): number {
  const t = text.toLowerCase();
  let total = 0;
  for (const w of words) {
    const i = t.indexOf(w);
    if (i === -1) return -1;
    total += i === 0 ? 0 : t[i - 1] === " " ? 1 : 2;
  }
  return total;
}

/**
 * The top bar's search: jump to any résumé, job description, cover letter,
 * interview question set or page by name. Ctrl/⌘ K focuses it; arrows move,
 * Enter opens, Escape closes. Your data is only fetched once it's first
 * opened (and is usually cached already).
 */
export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const resumes = useQuery<Resume[]>({ queryKey: ["resumes"], queryFn: () => apiClient.getResumes(), enabled: used });
  const jds = useQuery<JobDescription[]>({ queryKey: ["jds"], queryFn: () => apiClient.getJds(), enabled: used });
  const letters = useQuery<CoverLetter[]>({
    queryKey: ["coverLetters"],
    queryFn: () => apiClient.getCoverLetters(),
    enabled: used,
  });
  const questions = useQuery<PrepQuestionWithJdOut[]>({
    queryKey: ["myQuestions"],
    queryFn: () => apiClient.getMyQuestions(),
    enabled: used,
  });
  const loading = used && [resumes, jds, letters, questions].some((q) => q.isLoading);

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  // Ctrl/⌘ K from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const jdTitle = new Map((jds.data ?? []).map((j) => [j.id, j.title]));
    const pages: Hit[] = APP_NAV.map((n) => ({
      key: `page-${n.href}`, group: "Pages", label: n.label, href: n.href, icon: n.icon,
    }));
    const recentJds = [...(jds.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const jdHits: Hit[] = recentJds.map((j) => ({
      key: `jd-${j.id}`, group: "Job descriptions", label: j.title, href: `/jd/${j.id}`, icon: FileDashed,
      hint: j.ats_score != null ? `ATS ${Math.round(j.ats_score)}` : undefined,
      body: j.raw_text,
    }));
    const resumeHits: Hit[] = (resumes.data ?? []).map((r) => ({
      key: `resume-${r.id}`, group: "Résumés", label: r.title, href: `/studio/${r.id}`, icon: FileText,
    }));
    const letterHits: Hit[] = (letters.data ?? [])
      .filter((l) => l.status === "completed")
      .map((l) => ({
        key: `letter-${l.id}`, group: "Cover letters", label: `Cover letter — ${jdTitle.get(l.jd_id) ?? "a job"}`,
        href: `/cover-letters/${l.id}`, icon: EnvelopeSimple,
      }));
    const interviewHits: Hit[] = [...new Map((questions.data ?? []).map((q) => [q.jd_id, q.jd_title])).entries()].map(
      ([id, title]) => ({
        key: `iq-${id}`, group: "Interview questions", label: `Interview questions — ${title}`,
        href: `/interview?jd=${encodeURIComponent(id)}`, icon: MicrophoneStage,
      }),
    );

    // Nothing typed: the pages, and the jobs you looked at last.
    if (words.length === 0) return [...pages, ...jdHits.slice(0, 3)];

    const ranked = (xs: Hit[]) =>
      xs
        .map((h) => {
          const s = score(h.label, words);
          if (s >= 0 || !h.body) return { h, s };
          // Matched only inside the text: after every title match, and say so.
          return score(h.body, words) >= 0 ? { h: { ...h, hint: "in the job text" }, s: 1000 } : { h, s: -1 };
        })
        .filter((x) => x.s >= 0)
        .sort((a, b) => a.s - b.s)
        .slice(0, PER_GROUP)
        .map((x) => x.h);
    return [
      ...ranked(jdHits),
      ...ranked(resumeHits),
      ...ranked(interviewHits),
      ...ranked(letterHits),
      ...ranked(pages),
    ];
  }, [query, jds.data, resumes.data, letters.data, questions.data]);

  useEffect(() => setActive(0), [query]);

  function go(h: Hit | undefined) {
    if (!h) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(h.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  // Keep the highlighted row in view.
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div ref={boxRef} className="relative ml-sm w-80">
      <div className="flex items-center bg-surface-container-low rounded-full px-md h-10 border border-outline-variant/30 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
        <MagnifyingGlass size={20} className="text-on-surface-variant shrink-0" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search your résumés, jobs and pages"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setUsed(true);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="bg-transparent border-none focus:ring-0 text-body-sm text-on-surface w-full h-full ml-sm outline-none placeholder:text-on-surface-variant/60"
          placeholder="Search résumés, jobs, pages…"
          type="text"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="hidden lg:inline shrink-0 ml-xs px-xs rounded border border-outline-variant/40 text-caption text-on-surface-variant/70 font-sans">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 top-full mt-xs w-[26rem] max-h-[70vh] overflow-y-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl shadow-on-surface/10 p-xs z-50"
        >
          {hits.length === 0 ? (
            <p className="px-md py-md text-body-sm text-on-surface-variant">
              {loading ? "Searching…" : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            hits.map((h, i) => {
              const first = i === 0 || hits[i - 1].group !== h.group;
              const Icon = h.icon;
              return (
                <div key={h.key}>
                  {first && (
                    <p className="px-sm pt-sm pb-xs text-caption text-on-surface-variant uppercase tracking-wider">
                      {query.trim() === "" && h.group === "Job descriptions" ? "Recent jobs" : h.group}
                    </p>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(h)}
                    className={`flex items-center gap-sm px-sm py-sm rounded-lg cursor-pointer text-body-sm ${
                      i === active ? "bg-secondary-container text-on-surface" : "text-on-surface"
                    }`}
                  >
                    <Icon size={18} className="shrink-0 text-primary" />
                    <span className="flex-1 min-w-0 truncate">{h.label}</span>
                    {h.hint && <span className="shrink-0 text-caption text-on-surface-variant">{h.hint}</span>}
                    {i === active && <ArrowRight size={14} className="shrink-0 text-on-surface-variant" />}
                  </div>
                </div>
              );
            })
          )}
          {loading && hits.length > 0 && (
            <p className="px-sm py-xs text-caption text-on-surface-variant">Loading your files…</p>
          )}
        </div>
      )}
    </div>
  );
}
