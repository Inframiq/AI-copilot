import { describe, it, expect, vi, afterEach } from "vitest";

// A stand-in for the browser's Worker: answers through `reply`, or fails.
let reply: ((msg: { id: number; kind: string; text: string; op: string }) => unknown) | "fail";
const posted: unknown[] = [];

class FakeWorker extends EventTarget {
  constructor(public url: URL, public opts: WorkerOptions) {
    super();
  }
  postMessage(msg: { id: number; kind: string; text: string; op: string }) {
    posted.push(msg);
    setTimeout(() => {
      if (reply === "fail") this.dispatchEvent(new Event("error"));
      else this.dispatchEvent(new MessageEvent("message", { data: reply(msg) }));
    }, 0);
  }
}

async function freshClient() {
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  posted.length = 0;
  return import("@/lib/suggest/client");
}

afterEach(() => vi.unstubAllGlobals());

describe("suggestions through the worker", () => {
  it("asks the worker, and gives its answer", async () => {
    reply = ({ id }) => ({ id, items: ["JavaScript", "Java"], exact: "JavaScript" });
    const { ask, canonicalFor } = await freshClient();
    expect(await ask("skill", "js")).toEqual({ items: ["JavaScript", "Java"], exact: "JavaScript" });
    expect(await canonicalFor("skill", "js")).toBe("JavaScript");
    expect(posted[0]).toMatchObject({ kind: "skill", text: "js", op: "ask" });
  });

  it("matches each answer to its own question", async () => {
    reply = ({ id, text }) => ({ id, items: [text.toUpperCase()], exact: null });
    const { ask } = await freshClient();
    const [a, b] = await Promise.all([ask("skill", "go"), ask("skill", "rust")]);
    expect(a.items).toEqual(["GO"]);
    expect(b.items).toEqual(["RUST"]);
  });

  it("answers on the page when the worker fails, then and afterwards", async () => {
    reply = "fail";
    const { ask } = await freshClient();
    expect((await ask("skill", "js")).items[0]).toBe("JavaScript");
    const before = posted.length;
    expect((await ask("skill", "kubern")).items[0]).toBe("Kubernetes");
    expect(posted.length).toBe(before);
  });

  it("answers on the page where there's no worker at all", async () => {
    vi.resetModules();
    vi.stubGlobal("Worker", undefined);
    const { ask } = await import("@/lib/suggest/client");
    expect((await ask("degree", "btech")).exact).toBe("Bachelor of Technology (B.Tech)");
  });
});
