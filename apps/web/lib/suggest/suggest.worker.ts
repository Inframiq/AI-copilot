/// <reference lib="webworker" />
// Loads, indexes and searches the suggestion lists off the page's main
// thread (see ./client.ts). The college list is 64,000 names: parsing and
// indexing it on the page stalled typing for seconds on a slow phone.
import { canonicalName, loadSuggestions, suggest, type SuggestKind } from "./index";

export type WorkerRequest = { id: number; kind: SuggestKind; text: string; op: "ask" | "warm" };
export type WorkerReply = { id: number; items: string[]; exact: string | null } | { id: number; error: true };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, kind, text, op } = event.data;
  try {
    const index = await loadSuggestions(kind);
    const reply: WorkerReply = op === "warm"
      ? { id, items: [], exact: null }
      : { id, items: suggest(index, text), exact: canonicalName(index, text) };
    self.postMessage(reply);
  } catch {
    self.postMessage({ id, error: true } satisfies WorkerReply);
  }
};
