// Driver for run-ai-copilot. Node/Playwright script (no chromium-cli on this
// Windows host — see SKILL.md Gotchas). Run with:
//   node .claude/skills/run-ai-copilot/driver.mjs
//
// Requires: API on :8000 and web dev server on :3000 already running
// (see SKILL.md "Run (agent path)").

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const API = process.env.API_BASE ?? "http://localhost:8000";
const WEB = process.env.WEB_BASE ?? "http://localhost:3000";

async function checkApi() {
  const res = await fetch(`${API}/health`);
  const body = await res.json();
  console.log(`[api] GET /health -> ${res.status} ${JSON.stringify(body)}`);
  if (!res.ok || body.status !== "ok") throw new Error("API health check failed");

  const docs = await fetch(`${API}/docs`);
  console.log(`[api] GET /docs -> ${docs.status}`);
  if (!docs.ok) throw new Error("API /docs did not respond");
}

async function driveWeb() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(WEB, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Get Started Free");
  console.log(`[web] landing page title: ${await page.title()}`);
  await page.screenshot({ path: join(SHOTS, "01-landing.png"), fullPage: true });

  // Real user flow: landing -> Sign In -> login form renders.
  await page.click("text=Sign In");
  await page.waitForURL(/\/login/);
  await page.waitForSelector('input[type="email"], input[name="email"]');
  console.log(`[web] navigated to: ${page.url()}`);
  await page.screenshot({ path: join(SHOTS, "02-login.png"), fullPage: true });

  console.log(`[web] console errors: ${consoleErrors.length ? consoleErrors.join(" | ") : "none"}`);
  await browser.close();

  if (consoleErrors.length) {
    console.warn("WARNING: browser console reported errors (see above)");
  }
}

try {
  await checkApi();
  await driveWeb();
  console.log(`\nOK — screenshots in ${SHOTS}`);
} catch (err) {
  console.error("DRIVER FAILED:", err);
  process.exit(1);
}
