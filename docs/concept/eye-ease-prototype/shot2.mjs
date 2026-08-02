import { chromium } from "playwright";
import { pathToFileURL } from "url";
const url = pathToFileURL(new URL("./index.html", import.meta.url).pathname).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
await page.goto(url);
await page.waitForTimeout(1200);
// atlas
await page.keyboard.press("6");
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/atlas2.png" });
// bench with delta lens held
await page.keyboard.press("4");
await page.waitForTimeout(300);
await page.keyboard.down("d");
await page.waitForTimeout(300);
await page.screenshot({ path: "shots/bench-lens.png" });
await page.keyboard.up("d");
// today with a peeked brief sentence
await page.keyboard.press("1");
await page.waitForTimeout(5600);
const sents = page.locator("#brief .sent");
await sents.nth(1).click();
await page.waitForTimeout(300);
await page.screenshot({ path: "shots/today-peek.png" });
await browser.close();
console.log("done");
