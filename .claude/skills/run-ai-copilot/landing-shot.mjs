// Landing page only: desktop and phone screenshots, no API needed.
import { chromium } from "playwright";
const out = new URL("./screenshots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const tag = process.argv[2] ?? "landing";
const browser = await chromium.launch();
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  // Sections fade in as they scroll into view: walk the page so a full-page
  // capture shows them, then return to the top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}${tag}-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log("ok");
