/**
 * What fields use to get suggestions: answers come from a worker that holds
 * the lists (suggest.worker.ts), so loading and searching 64,000 colleges
 * never holds up typing. Where there's no worker (tests, a browser without
 * module workers) or it fails, the same search runs on the page.
 */
import { canonicalName, fold, loadSuggestions, suggest, type SuggestKind } from "./index";
import type { WorkerReply, WorkerRequest } from "./suggest.worker";

export interface Answer {
  /** Up to eight names for what's typed, best first. */
  items: string[];
  /** The list's name for exactly what's typed, or null. */
  exact: string | null;
}

type Pending = { resolve: (a: Answer) => void; reject: (e: unknown) => void };

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" ? null : new Worker(new URL("./suggest.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  worker?.addEventListener("message", (e: MessageEvent<WorkerReply>) => {
    const call = pending.get(e.data.id);
    if (!call) return;
    pending.delete(e.data.id);
    if ("error" in e.data) call.reject(new Error("suggestions unavailable"));
    else call.resolve({ items: e.data.items, exact: e.data.exact });
  });
  // A worker that can't start (blocked, failed to load): every waiting
  // question is answered on the page instead, and so is every later one.
  worker?.addEventListener("error", () => {
    worker = null;
    for (const call of pending.values()) call.reject(new Error("worker failed"));
    pending.clear();
  });
  return worker;
}

async function onPage(kind: SuggestKind, text: string): Promise<Answer> {
  const index = await loadSuggestions(kind);
  return { items: suggest(index, text), exact: canonicalName(index, text) };
}

function post(kind: SuggestKind, text: string, op: WorkerRequest["op"]): Promise<Answer> {
  const w = getWorker();
  if (!w) return onPage(kind, text);
  const id = ++nextId;
  return new Promise<Answer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, kind, text, op } satisfies WorkerRequest);
  }).catch(() => onPage(kind, text));
}

/** Suggestions for what's typed. */
export function ask(kind: SuggestKind, text: string): Promise<Answer> {
  return post(kind, text, "ask");
}

/** The list's name for exactly this text — "js" → "JavaScript" — or null. */
export async function canonicalFor(kind: SuggestKind, text: string): Promise<string | null> {
  return text.trim() ? (await ask(kind, text)).exact : null;
}

/**
 * The entry among `existing` that is the same as `value`: the same once
 * folded, or the same name once aliases are read as their names ("JS" and
 * "JavaScript"). Null when it's new.
 */
export async function findRepeat(kind: SuggestKind, value: string, existing: readonly string[]): Promise<string | null> {
  const key = async (v: string) => fold((await canonicalFor(kind, v).catch(() => null)) ?? v);
  const mine = await key(value);
  if (!mine) return null;
  const theirs = await Promise.all(existing.map(key));
  const at = theirs.indexOf(mine);
  return at >= 0 ? existing[at] : null;
}

/** Start loading a list, so it's ready by the time anything is typed. */
export function warm(kind: SuggestKind): void {
  void post(kind, "", "warm").catch(() => {});
}
