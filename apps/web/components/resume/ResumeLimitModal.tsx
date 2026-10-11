"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleNotch, DownloadSimple, Trash, Warning, X } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { downloadFile } from "@/lib/download";
import { useResumeLimitStore, type LimitResume, type ResumeLimitInfo } from "@/stores/resume-limit-store";

/**
 * Asks before a new résumé pushes an old one out (the server refuses past
 * the limit instead of deleting silently — see stores/resume-limit-store).
 * Names the résumé that will go, lets the user export it first or pick a
 * different one, and only deletes on "Delete & continue". Mounted once,
 * app-wide, in app/providers.tsx.
 */
export function ResumeLimitModal() {
  const info = useResumeLimitStore((s) => s.info);
  const resolve = useResumeLimitStore((s) => s.resolve);
  if (!info || !resolve) return null;
  return <LimitDialog key={info.suggested.join(",")} info={info} resolve={resolve} />;
}

function edited(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 30) return `Edited ${days} days ago`;
  return `Edited ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "Jane's Resume — Acme.pdf": the title, minus what a file system rejects. */
function pdfName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]+/g, "").trim();
  return `${clean || "Resume"}.pdf`;
}

function names(rows: LimitResume[]): string {
  const t = rows.map((r) => `“${r.title}”`);
  return t.length <= 1 ? t.join("") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
}

function LimitDialog({ info, resolve }: { info: ResumeLimitInfo; resolve: (madeRoom: boolean) => void }) {
  const queryClient = useQueryClient();
  const single = info.need === 1;
  const [chosen, setChosen] = useState<string[]>(info.suggested.slice(0, info.need));
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<{ id: string; message: string } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const chosenRows = info.resumes.filter((r) => chosen.includes(r.id));
  const enough = chosen.length >= info.need;

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !deleting && resolve(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleting, resolve]);

  function toggle(id: string) {
    setError(null);
    if (single) return setChosen([id]);
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function exportPdf(r: LimitResume) {
    setExportError(null);
    setExporting(r.id);
    try {
      const { signed_url } = await apiClient.generatePdf(r.id, r.template_id);
      // The PDF comes back as a data: URL, which browsers won't open in a
      // tab — saved as a file, named after the résumé.
      await downloadFile(signed_url, pdfName(r.title));
    } catch (e) {
      setExportError({ id: r.id, message: e instanceof Error ? e.message : "Couldn't export it. Try again." });
    } finally {
      setExporting(null);
    }
  }

  async function deleteAndContinue() {
    if (!enough) return;
    setDeleting(true);
    setError(null);
    let deletedAny = false;
    try {
      for (const id of chosen) {
        await apiClient.deleteResume(id);
        deletedAny = true;
      }
      resolve(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete it. Try again.");
      setDeleting(false);
    } finally {
      if (deletedAny) {
        // Lists, the profile's main résumé and JDs' saved résumés may all
        // have changed.
        for (const key of [["resumes"], ["careerProfile"], ["jds"], ["jdDetails"]]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    }
  }

  const warnings = chosenRows.flatMap((r) => [
    ...(r.is_master ? [`“${r.title}” is your profile's main résumé — your profile will stop pointing to it.`] : []),
    ...(r.jd_title
      ? [`“${r.title}” is the résumé saved for ${r.jd_title}. The job stays, but you'll need to save a résumé to it again.`]
      : []),
  ]);

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-on-surface/30 backdrop-blur-sm" onClick={() => !deleting && resolve(false)} />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center p-sm sm:p-lg pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-limit-title"
          className="pointer-events-auto w-full max-w-[32rem] max-h-[90vh] flex flex-col bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl"
        >
          <div className="p-md sm:p-lg pb-sm flex items-start gap-md">
            <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center shrink-0">
              <Trash size={20} className="text-error" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="resume-limit-title" ref={titleRef} tabIndex={-1} className="text-headline-md text-on-surface font-semibold outline-none">
                {chosenRows.length > 0
                  ? `${names(chosenRows)} will be deleted`
                  : single ? "Choose a résumé to delete" : `Choose ${info.need} résumés to delete`}
              </h2>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                You can keep up to {info.limit} résumés. To add this one,{" "}
                {single ? "one has to go" : `${info.need} have to go`}. Export{" "}
                {single ? "it" : "them"} first to keep a copy, or choose{" "}
                {single ? "a different résumé" : "different ones"} to delete.
              </p>
            </div>
            <button
              onClick={() => resolve(false)}
              disabled={deleting}
              aria-label="Cancel"
              className="shrink-0 p-xs -m-xs rounded-full text-on-surface-variant hover:bg-surface-container-high/50 disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>

          <div
            role={single ? "radiogroup" : "group"}
            aria-label="Résumés"
            className="flex-1 overflow-y-auto px-md sm:px-lg flex flex-col gap-xs py-xs"
          >
            {info.resumes.map((r) => {
              const on = chosen.includes(r.id);
              return (
                <div key={r.id}>
                  <div
                    className={`flex items-center gap-sm rounded-xl border px-sm py-sm transition-colors ${
                      on ? "border-error/40 bg-error/5" : "border-outline-variant/30 hover:bg-surface-container-low"
                    }`}
                  >
                    <label className="flex-1 min-w-0 flex items-center gap-sm cursor-pointer">
                      <input
                        type={single ? "radio" : "checkbox"}
                        name="resume-to-delete"
                        checked={on}
                        onChange={() => toggle(r.id)}
                        disabled={deleting}
                        className="w-4 h-4 shrink-0 accent-error"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-label-md text-on-surface truncate">{r.title}</span>
                        <span className="flex flex-wrap items-center gap-x-sm gap-y-0.5 text-caption text-on-surface-variant">
                          <span>{edited(r.updated_at)}</span>
                          {r.is_master && <span className="text-primary">Main résumé</span>}
                          {r.jd_title && <span className="text-primary truncate max-w-[12rem]">Saved for {r.jd_title}</span>}
                          {on && <span className="text-error font-semibold">Will be deleted</span>}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => exportPdf(r)}
                      disabled={exporting !== null || deleting}
                      aria-label={`Export ${r.title} as PDF`}
                      className="shrink-0 inline-flex items-center gap-xs px-sm py-xs rounded-lg border border-outline-variant/40 text-label-sm text-on-surface hover:bg-surface-container disabled:opacity-50"
                    >
                      {exporting === r.id ? (
                        <CircleNotch size={14} className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <DownloadSimple size={14} />
                      )}
                      <span className="hidden sm:inline">Export</span>
                    </button>
                  </div>
                  {exportError?.id === r.id && (
                    <p role="alert" className="text-caption text-error px-sm pt-xs">{exportError.message}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-md sm:p-lg pt-sm flex flex-col gap-sm border-t border-outline-variant/20">
            {warnings.map((w) => (
              <p key={w} className="flex items-start gap-xs text-caption text-on-surface-variant">
                <Warning size={14} className="shrink-0 mt-0.5 text-error" /> {w}
              </p>
            ))}
            {!enough && !single && (
              <p className="text-caption text-on-surface-variant">
                Choose {info.need - chosen.length} more to delete.
              </p>
            )}
            {error && <p role="alert" className="text-caption text-error">{error}</p>}
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => resolve(false)}
                disabled={deleting}
                className="flex-1 py-sm rounded-xl border border-outline-variant/40 text-label-md text-on-surface hover:bg-surface-container disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteAndContinue}
                disabled={!enough || deleting}
                className="flex-1 inline-flex items-center justify-center gap-xs py-sm rounded-xl bg-error text-on-error text-label-md font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {deleting && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />}
                {deleting ? "Deleting…" : "Delete & continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
