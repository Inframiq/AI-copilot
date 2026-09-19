// Phone-width landing page, one screenshot per section, plus a width check.
import { chromium } from "playwright";
const out = new URL("./screenshots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
});
await page.waitForTimeout(1200);
console.log("scrollWidth", await page.evaluate(() => document.documentElement.scrollWidth));
const sections = page.locator("main > section");
const n = await sections.count();
for (let i = 0; i < n; i++) await sections.nth(i).screenshot({ path: `${out}phone-s${i}.png` });
await browser.close();
console.log("sections", n);
