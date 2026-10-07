import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { format } from "node:util";

// Invalid nesting (a <button> inside a <button>, a <div> inside a <p>) works
// when React builds the DOM, so it looks fine in a test. In server-rendered
// HTML the browser's parser splits it apart instead: hydration fails and a
// stray copy of the page is left on screen (the dashboard did this). React
// only logs it, so fail the test here.
const nestingErrors: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const message = format(...args);
  if (/cannot be a descendant of|cannot contain a nested|cannot be a child of/.test(message)) {
    nestingErrors.push(message.split("\n")[0]);
  }
  originalConsoleError(...args);
};
afterEach(() => {
  if (nestingErrors.length > 0) {
    throw new Error(`Invalid HTML nesting:\n${nestingErrors.splice(0).join("\n")}`);
  }
});

// jsdom doesn't implement ResizeObserver — Radix UI (Slider, etc.) needs it.
// Guarded so this is a no-op under the default "node" test environment.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
