import { create } from "zustand";
import { isResumeLimitCancelled } from "@/stores/resume-limit-store";
import { apiClient, isResumeChanged } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";
import type { Resume, ResumeContent } from "@career-copilot/types";
import { wordCapError } from "@/lib/profile-sections";

const DEFAULT_LINE_SPACING = 1.25;
const DEFAULT_PARAGRAPH_SPACING = 12;
const DEFAULT_FONT_CHOICE = "sans";

/**
 * Skills as the Studio needs them: a flat list of strings.
 *
 * The API stores résumé content as it was sent and its templates also draw
 * skills grouped by category ({"Languages": ["Go"]}), so a résumé saved in
 * that shape — or with skills missing — used to crash every Studio page that
 * calls skills.filter. Grouped skills keep their words, in order; anything
 * that is not a string is dropped.
 */
export function withSkillList(content: ResumeContent): ResumeContent {
  if (!content) return content;
  const raw: unknown = content.skills;
  if (Array.isArray(raw) && raw.every((s) => typeof s === "string")) return content;
  const values = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw).flat() : [];
  return { ...content, skills: values.filter((s): s is string => typeof s === "string") };
}

/** What a draft replaces, so discarding it restores all of it. */
interface DraftBase {
  content: ResumeContent | null;
  templateId: string;
  lineSpacing: number;
  paragraphSpacing: number;
  fontChoice: string;
  accentColor: string | null;
  headingSizeDelta: number;
  bodySizeDelta: number;
}

interface ResumeState {
  resumeId: string | null;
  content: ResumeContent | null;
  templateId: string;
  /** CSS line-height multiplier applied when rendering this resume's PDF. */
  lineSpacing: number;
  /** Space in px after each bullet list / summary / plain list. */
  paragraphSpacing: number;
  /** Key into the backend's FONT_STACKS map (see services/pdf.py). */
  fontChoice: string;
  headingSizeDelta: number;
  bodySizeDelta: number;
  /** "#RRGGBB", or null to use the template's own default accent color. */
  accentColor: string | null;
  isDirty: boolean;
  /** True while the debounced auto-save's PATCH request is actually in flight. */
  isSaving: boolean;
  /** Message from the most recent failed save, cleared on the next edit or
   * successful save — surfaced in the UI so a failed save is never silent. */
  saveError: string | null;
  pdfSignedUrl: string | null;
  /** True when the most recently rendered preview is a single page that
   *  doesn't fill down to the bottom. The backend computes it (pdf.py's
   *  UNDERFILL_PAGE_FILL_THRESHOLD) and the tailoring store writes it here.
   *
   *  Nothing displays it. Its banner lived in the preview dock, which the
   *  Studio replaced and which was deleted along with its orphans; the flag
   *  is kept because it is still computed and still true, and it is the seam
   *  to hang the advisory back on. Reset whenever a new resume loads. */
  previewUnderfilled: boolean;
  /** Whether the split preview pane is showing. Starts closed — an empty
   *  "no preview yet" pane eats half the screen for nothing before the user
   *  has asked for one. Opened by the studio header's "Preview" button, the
   *  effect that finds an already-generated PDF on load, and any explicit
   *  "preview" action buried in the editor (e.g. BulletReviewPanel's
   *  Preview/Regenerate Preview) so a preview request always lands
   *  somewhere visible. */
  previewOpen: boolean;
  /** Open state of <PhotoRequirementModal>, shared between the studio page
   *  (auto-trigger on template change) and EditorPanel ("Change photo"). */
  photoModalOpen: boolean;
  /** Template id to restore if the user cancels an auto-triggered prompt.
   *  null when the modal was opened manually (nothing to revert). */
  photoModalRevertTo: string | null;
  _saveTimer: ReturnType<typeof setTimeout> | null;
  /** Set while the store holds a tailored draft that has not been saved to
   *  its JD yet: the JD's id. resumeId is then still the résumé tailoring
   *  ran against — usually the profile's master — so autosave is off
   *  entirely. Nothing reaches the server until saveDraftToJd, which writes
   *  a separate résumé linked to the JD. Cleared by setResume. */
  draftJdId: string | null;
  /** What the draft was built on, restored by discardDraft. */
  _draftBase: DraftBase | null;
  /** The résumé's updated_at as this device last got it from the server.
   *  Every save sends it, so a save made from an out-of-date copy is refused
   *  rather than overwriting what another device saved in between. */
  updatedAt: string | null;
  /** Set when a save was refused because the résumé changed on another
   *  device: that device's version. Autosave holds (edits keep piling up
   *  here, unsaved) until ResumeConflictModal's choice — keepMine or
   *  loadTheirs. */
  conflictUpdatedAt: string | null;

  setResume: (
    id: string,
    content: ResumeContent,
    templateId: string,
    lineSpacing?: number,
    paragraphSpacing?: number,
    fontChoice?: string,
    accentColor?: string | null,
    headingSizeDelta?: number,
    bodySizeDelta?: number,
    updatedAt?: string | null,
  ) => void;
  updateContent: (partial: Partial<ResumeContent>) => void;
  /** Load a tailored résumé as an unsaved draft for this JD. The résumé it
   *  came from is never written: see draftJdId. */
  startDraft: (content: ResumeContent, jdId: string) => void;
  /** Drop an unsaved draft and put back the content it was built on. */
  discardDraft: () => void;
  /** Save the draft as the tailored résumé for its JD — a new résumé, or the
   *  one already linked to that JD, never the source — and switch the store
   *  to it so later edits autosave there. Returns the saved résumé's id. */
  saveDraftToJd: (title: string) => Promise<string>;
  setTemplateId: (id: string) => void;
  setSpacing: (lineSpacing: number, paragraphSpacing: number) => void;
  setFontChoice: (fontChoice: string) => void;
  /** Points added to the sizes the template declares, headings and body
   *  content independently. 0 is "standard" — the template's own numbers,
   *  which are what a résumé is generated at. */
  setTextSize: (which: "heading" | "body", delta: number) => void;
  setAccentColor: (accentColor: string | null) => void;
  setPdfSignedUrl: (url: string | null) => void;
  setPreviewUnderfilled: (underfilled: boolean) => void;
  setPreviewOpen: (open: boolean) => void;
  setPhotoModal: (open: boolean, revertTo?: string | null) => void;
  resetStore: () => void;
  /** Bypasses the debounce and persists immediately — for callers that need
   *  the backend to be caught up before doing something else (e.g. a PDF
   *  regen right after AI tailoring writes new content). */
  saveNow: () => Promise<void>;
  /** After a conflict: save this device's copy over the other device's. */
  keepMine: () => Promise<void>;
  /** After a conflict: drop this device's unsaved edits and load the résumé
   *  as the other device saved it. */
  loadTheirs: () => Promise<void>;
  /** Internal — exposed for testing */
  _triggerAutoSave: () => void;
}

const AUTO_SAVE_DELAY_MS = 2000;

/** The save in flight, if any. Saves go one at a time: each sends the
 *  version the previous one got back, so two of this device's own saves
 *  overlapping would have the server refuse the second as stale. */
let inFlightSave: Promise<void> | null = null;

/** Keep the cached copies in step with a save, so reopening the résumé from
 *  cache doesn't load what this device has already saved over — and then
 *  look like another device's change on the next save. */
function cacheSaved(saved: Resume) {
  queryClient.setQueryData<Resume>(["resume", saved.id], saved);
  queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
    list?.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)),
  );
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  resumeId: null,
  content: null,
  templateId: "ats_clean",
  lineSpacing: DEFAULT_LINE_SPACING,
  paragraphSpacing: DEFAULT_PARAGRAPH_SPACING,
  fontChoice: DEFAULT_FONT_CHOICE,
  headingSizeDelta: 0,
  bodySizeDelta: 0,
  accentColor: null,
  isDirty: false,
  isSaving: false,
  saveError: null,
  pdfSignedUrl: null,
  previewUnderfilled: false,
  previewOpen: false,
  photoModalOpen: false,
  photoModalRevertTo: null,
  _saveTimer: null,
  draftJdId: null,
  _draftBase: null,
  updatedAt: null,
  conflictUpdatedAt: null,

  setResume: (
    id, content, templateId, lineSpacing, paragraphSpacing, fontChoice, accentColor,
    headingSizeDelta, bodySizeDelta, updatedAt,
  ) =>
    set({
      draftJdId: null,
      _draftBase: null,
      updatedAt: updatedAt ?? null,
      conflictUpdatedAt: null,
      resumeId: id,
      content: withSkillList(content),
      templateId,
      lineSpacing: lineSpacing ?? DEFAULT_LINE_SPACING,
      paragraphSpacing: paragraphSpacing ?? DEFAULT_PARAGRAPH_SPACING,
      fontChoice: fontChoice ?? DEFAULT_FONT_CHOICE,
      accentColor: accentColor ?? null,
      headingSizeDelta: headingSizeDelta ?? 0,
      bodySizeDelta: bodySizeDelta ?? 0,
      isDirty: false,
      isSaving: false,
      saveError: null,
      pdfSignedUrl: null,
      previewUnderfilled: false,
      previewOpen: false,
    }),

  updateContent: (partial) => {
    const current = get().content;
    set({
      content: current ? { ...current, ...partial } : (partial as ResumeContent),
      isDirty: true,
      saveError: null,
    });
    get()._triggerAutoSave();
  },

  startDraft: (content, jdId) => {
    // A save queued for the source résumé must not land after this.
    const timer = get()._saveTimer;
    if (timer !== null) clearTimeout(timer);
    const s = get();
    set({
      content: withSkillList(content),
      draftJdId: jdId,
      // Re-applying over a draft keeps the original as the base, not the draft.
      _draftBase: s.draftJdId
        ? s._draftBase
        : {
            content: s.content,
            templateId: s.templateId,
            lineSpacing: s.lineSpacing,
            paragraphSpacing: s.paragraphSpacing,
            fontChoice: s.fontChoice,
            accentColor: s.accentColor,
            headingSizeDelta: s.headingSizeDelta,
            bodySizeDelta: s.bodySizeDelta,
          },
      isDirty: false,
      saveError: null,
      _saveTimer: null,
    });
  },

  discardDraft: () => {
    const base = get()._draftBase;
    if (!get().draftJdId || !base) return;
    set({ ...base, draftJdId: null, _draftBase: null, isDirty: false });
  },

  saveDraftToJd: async (title) => {
    const {
      draftJdId, content, templateId, lineSpacing, paragraphSpacing, fontChoice,
      accentColor, headingSizeDelta, bodySizeDelta,
    } = get();
    if (!draftJdId || !content) throw new Error("There is no tailored draft to save.");
    set({ isSaving: true, saveError: null });
    try {
      // POST with jd_id, never PATCH: the backend creates the JD's own
      // résumé, or overwrites the one already linked to it (never the
      // profile's master), so the source résumé cannot be touched here.
      const saved = await apiClient.createResume({
        title,
        content,
        template_id: templateId,
        line_spacing: lineSpacing,
        paragraph_spacing: paragraphSpacing,
        font_choice: fontChoice,
        accent_color: accentColor,
        heading_size_delta: headingSizeDelta,
        body_size_delta: bodySizeDelta,
        jd_id: draftJdId,
      });
      get().setResume(
        saved.id, content, templateId, lineSpacing, paragraphSpacing, fontChoice,
        accentColor, headingSizeDelta, bodySizeDelta, saved.updated_at,
      );
      cacheSaved(saved);
      return saved.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      set({ isSaving: false, saveError: isResumeLimitCancelled(err) ? null : message });
      throw err;
    }
  },

  setTemplateId: (id) => {
    set({ templateId: id, isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setSpacing: (lineSpacing, paragraphSpacing) => {
    set({ lineSpacing, paragraphSpacing, isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setTextSize: (which, delta) => {
    // Clamped to match the server, which will not render a larger step.
    const value = Math.max(-1, Math.min(1, Math.round(delta)));
    set(which === "heading" ? { headingSizeDelta: value } : { bodySizeDelta: value });
    set({ isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setFontChoice: (fontChoice) => {
    set({ fontChoice, isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setAccentColor: (accentColor) => {
    set({ accentColor, isDirty: true, saveError: null });
    get()._triggerAutoSave();
  },

  setPdfSignedUrl: (url) => set({ pdfSignedUrl: url }),

  setPreviewUnderfilled: (underfilled) => set({ previewUnderfilled: underfilled }),

  setPreviewOpen: (open) => set({ previewOpen: open }),

  setPhotoModal: (open, revertTo = null) =>
    set({ photoModalOpen: open, photoModalRevertTo: open ? revertTo : null }),

  resetStore: () => {
    const timer = get()._saveTimer;
    if (timer !== null) clearTimeout(timer);
    set({
      resumeId: null,
      content: null,
      templateId: "ats_clean",
      lineSpacing: DEFAULT_LINE_SPACING,
      paragraphSpacing: DEFAULT_PARAGRAPH_SPACING,
      fontChoice: DEFAULT_FONT_CHOICE,
  headingSizeDelta: 0,
  bodySizeDelta: 0,
      accentColor: null,
      isDirty: false,
      isSaving: false,
      saveError: null,
      pdfSignedUrl: null,
      previewUnderfilled: false,
      previewOpen: false,
      photoModalOpen: false,
      photoModalRevertTo: null,
      _saveTimer: null,
      draftJdId: null,
      _draftBase: null,
      updatedAt: null,
      conflictUpdatedAt: null,
    });
  },

  _triggerAutoSave: () => {
    // A draft is saved only by saveDraftToJd; see draftJdId. During a
    // conflict nothing saves until the user chooses; see conflictUpdatedAt.
    if (get().draftJdId || get().conflictUpdatedAt) return;
    const prev = get()._saveTimer;
    if (prev !== null) clearTimeout(prev);
    const timer = setTimeout(() => {
      // saveNow() already records any failure into saveError below — this
      // catch exists only so a debounced call nobody awaits doesn't surface
      // as an unhandled promise rejection.
      get().saveNow().catch(() => {});
    }, AUTO_SAVE_DELAY_MS);
    set({ _saveTimer: timer });
  },

  saveNow: async () => {
    const timer = get()._saveTimer;
    if (timer !== null) clearTimeout(timer);
    set({ _saveTimer: null });

    // Wait out a save already going: this one must send the version it
    // returns. No await between the loop and claiming inFlightSave, so two
    // waiters woken together still go one after the other.
    while (inFlightSave) await inFlightSave.catch(() => {});

    const run = async () => {
      const {
        resumeId, content, templateId, lineSpacing, paragraphSpacing, fontChoice,
        accentColor, headingSizeDelta, bodySizeDelta, draftJdId, updatedAt, conflictUpdatedAt,
      } = get();
      // resumeId is the draft's source (usually the master) — never write it.
      if (!resumeId || !content || draftJdId) return;
      // Saving now would overwrite the other device's work, or be refused
      // again. The conflict popup is already asking which to keep.
      if (conflictUpdatedAt) throw new Error("This résumé was changed on another device.");
      // A summary past 80 words (an upload's, shown whole) isn't saved until
      // it's trimmed; the edits stay, unsaved, and the header says why.
      const overCap = wordCapError(content);
      if (overCap) {
        set({ saveError: overCap });
        throw new Error(overCap);
      }
      set({ isSaving: true });
      try {
        const saved = await apiClient.updateResume(resumeId, {
          content,
          template_id: templateId,
          line_spacing: lineSpacing,
          paragraph_spacing: paragraphSpacing,
          font_choice: fontChoice,
          accent_color: accentColor,
          heading_size_delta: headingSizeDelta,
          body_size_delta: bodySizeDelta,
          expected_updated_at: updatedAt,
        });
        // The user may have switched résumés while this was in flight.
        if (get().resumeId === resumeId) {
          set({ isDirty: false, isSaving: false, saveError: null, updatedAt: saved?.updated_at ?? updatedAt });
        }
        if (saved?.id) cacheSaved(saved);
      } catch (err) {
        const changed = isResumeChanged(err);
        if (get().resumeId !== resumeId) {
          // Switched to another résumé meanwhile: this one's refusal isn't
          // about what's on screen now.
        } else if (changed) {
          // Not a failure to report: ResumeConflictModal opens on this and
          // asks which copy to keep. isDirty stays true — nothing was saved.
          set({ isSaving: false, saveError: null, conflictUpdatedAt: changed.updated_at });
        } else {
          const message = err instanceof Error ? err.message : "Failed to save";
          console.error("Save failed:", err);
          set({ isSaving: false, saveError: message });
        }
        throw err;
      }
    };

    const save = run();
    inFlightSave = save;
    try {
      await save;
    } finally {
      if (inFlightSave === save) inFlightSave = null;
    }
  },

  keepMine: async () => {
    const theirs = get().conflictUpdatedAt;
    if (!theirs) return;
    // Saving over exactly the version the user was told about: if a third
    // save lands meanwhile, this is refused and they are asked again.
    set({ updatedAt: theirs, conflictUpdatedAt: null });
    await get().saveNow();
  },

  loadTheirs: async () => {
    const { resumeId, conflictUpdatedAt } = get();
    if (!resumeId || !conflictUpdatedAt) return;
    const r = await apiClient.getResume(resumeId);
    // A queued autosave would otherwise land these discarded edits after all.
    const timer = get()._saveTimer;
    if (timer !== null) clearTimeout(timer);
    set({ _saveTimer: null });
    get().setResume(
      r.id, r.content, r.template_id, r.line_spacing, r.paragraph_spacing, r.font_choice,
      r.accent_color, r.heading_size_delta, r.body_size_delta, r.updated_at,
    );
    cacheSaved(r);
  },
}));
