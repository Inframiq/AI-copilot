import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
const require = createRequire("D:/AI-Copilot/.claude/skills/run-ai-copilot/package.json");
const { chromium } = require("playwright");
const [dir, out] = process.argv.slice(2);
const browser = await chromium.launch();
// 834x1179 like the existing thumbnails: an A4 page at 96 dpi, x1.05.
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.05 });
for (const f of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  await page.goto("file:///" + dir.split(String.fromCharCode(92)).join("/") + "/" + f);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${f.replace(".html", ".png")}`, clip: { x: 0, y: 0, width: 794, height: 1123 } });
  console.log(f);
}
await browser.close();
