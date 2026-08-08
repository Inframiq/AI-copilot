import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver — Radix UI (Slider, etc.) needs it.
// Guarded so this is a no-op under the default "node" test environment.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
