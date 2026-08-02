import { chromium } from "playwright";
import { pathToFileURL } from "url";

const url = pathToFileURL(new URL("./index.html", import.meta.url).pathname).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", m => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text()); });
page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
await page.goto(url);
await page.waitForTimeout(6500); // let the brief settle

const folios = ["today", "field", "dossier", "bench", "book", "atlas", "legend"];
for (const f of folios) {
  await page.evaluate(id => window.go ? go(id, true) : null, f).catch(()=>{});
  await page.keyboard.press(String(folios.indexOf(f) + 1 <= 6 ? folios.indexOf(f) + 1 : "?")).catch(()=>{});
  await page.waitForTimeout(400);
  if (f === "dossier") {
    await page.screenshot({ path: `shots/${f}-top.png` });
    await page.evaluate(() => document.querySelector("#sheet").scrollTop = 1100);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/${f}-mid.png` });
    await page.evaluate(() => document.querySelector("#sheet").scrollTop = 2400);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/${f}-low.png` });
    continue;
  }
  await page.screenshot({ path: `shots/${f}.png`, fullPage: false });
}
// night mode sample
await page.evaluate(() => go("today", true));
await page.keyboard.press("n");
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/night.png" });
await browser.close();
console.log("done");
