/* Targeted state captures: overlays, tabs, chart surfaces — both themes. */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = ".audit/screenshots";

async function settle(page, ms = 1800) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.querySelectorAll(".uaa-boot-splash").forEach((n) => n.remove())).catch(() => {});
}

const STATES = [
  {
    name: "cmdk",
    route: "/",
    act: async (page) => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      await page.waitForTimeout(600);
    },
    full: false,
  },
  {
    name: "notifications",
    route: "/",
    act: async (page) => {
      await page.click('button[aria-label*="otification"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    full: false,
  },
  {
    name: "ai-assistant",
    route: "/",
    act: async (page) => {
      await page.click('button[aria-label*="ssistant"], button:has-text("AI · Devin")', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
    full: false,
  },
  {
    name: "research-analysis-tab",
    route: "/research?symbol=AAPL",
    act: async (page) => {
      await page.waitForTimeout(12000); // let quote + charts land
      await page.click('button:has-text("Analysis")', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
    },
    full: true,
  },
  {
    name: "research-financials-tab",
    route: "/research?symbol=AAPL",
    act: async (page) => {
      await page.waitForTimeout(8000);
      await page.click('button:has-text("Financials")', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
    },
    full: true,
  },
  {
    name: "calendar-drawer",
    route: "/calendar",
    act: async (page) => {
      await page.locator("main button, main [role=button]").filter({ hasText: /Research|Earnings/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    },
    full: false,
  },
  {
    name: "settings-forms",
    route: "/settings",
    act: async (page) => {
      await page.waitForTimeout(500);
    },
    full: true,
  },
];

const only = (process.argv.find((a) => a.startsWith("only=")) || "").replace("only=", "");
const themes = ((process.argv.find((a) => a.startsWith("themes=")) || "").replace("themes=", "") || "dark,light").split(",");
const browser = await chromium.launch();
for (const theme of themes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript((t) => {
    try { localStorage.setItem("uaa-theme", t); } catch {}
  }, theme);
  const page = await context.newPage();
  for (const s of STATES) {
    if (only && !only.split(",").includes(s.name)) continue;
    const dir = path.join(OUT, theme);
    fs.mkdirSync(dir, { recursive: true });
    try {
      await page.goto(BASE + s.route, { timeout: 90000, waitUntil: "domcontentloaded" });
      await settle(page);
      await s.act(page);
      await page.screenshot({ path: path.join(dir, `state-${s.name}@1440.png`), fullPage: s.full });
      console.log("ok", theme, s.name);
    } catch (e) {
      console.log("FAIL", theme, s.name, String(e).slice(0, 120));
    }
  }
  await context.close();
}
await browser.close();
