import { chromium } from '@playwright/test';
import fs from 'fs';
const digest = JSON.parse(fs.readFileSync('/tmp/home-digest.json', 'utf8'));
const deep = (o) => JSON.parse(JSON.stringify(o));

const states = {
  'new-user': (d) => {
    d.portfolioPulse = { ...d.portfolioPulse, status: 'empty', healthScore: null, healthGrade: null, totalValue: 0, todayChangePct: 0, todayChangeDollar: 0, bestPerformer: null, worstPerformer: null, cashPct: null, topContributors: [], radar: [], healthFactors: [], totalReturnOnCostPct: null };
    d.performance = { status: 'empty', xirrPct: null, holdingDays: 0, totalReturnPct: 0, totalReturnDollar: 0, benchmark: null };
    d.equityCurve = { ...d.equityCurve, status: 'empty', points: [], portfolioPct: null, benchmarkPct: null };
    d.attention = { ...d.attention, items: [], openCount: 0 };
    d.recommendedActions = { status: 'empty', actions: [], fromDecisionEngine: false, hasPortfolio: false };
    d.threats = { status: 'empty', threats: [], worstCasePct: null };
    d.watchlistIntelligence = { status: 'empty', buckets: [] };
    d.opportunityFeed = { ...d.opportunityFeed, opportunities: [] };
    d.changes = { status: 'ok', baselineAt: null, firstVisit: true, changes: [] };
    d.fallbackBriefing = 'No market or portfolio data available yet.';
    return d;
  },
  'degraded-market': (d) => {
    d.marketIntelligence = { status: 'degraded', groups: [], breadthPct: null, sentiment: null, regime: null, sectorAttention: [] };
    d.equityCurve = { ...d.equityCurve, status: 'degraded', points: [], portfolioPct: null, benchmarkPct: null };
    return d;
  },
  'all-clear-queue': (d) => { d.attention = { ...d.attention, items: [], openCount: 0 }; return d; },
};

const browser = await chromium.launch();
for (const [name, mutate] of Object.entries(states)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/api/home', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(mutate(deep(digest))) }));
  await page.route('**/api/home/brief', (route) => route.abort());
  await page.goto('http://localhost:3000/', { timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `docs/audits/today-dashboard/shots/states/${name}.png`, fullPage: true });
  await page.close();
}
// hard failure: /api/home 500
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/api/home', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Failed to build home digest"}' }));
  await page.goto('http://localhost:3000/', { timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'docs/audits/today-dashboard/shots/states/digest-500.png', fullPage: true });
  await page.close();
}
// slow network: never resolve -> skeleton state
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/api/home', () => {});
  await page.goto('http://localhost:3000/', { timeout: 30000 }).catch(()=>{});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'docs/audits/today-dashboard/shots/states/loading-skeleton.png', fullPage: true });
  await page.close();
}
await browser.close();
console.log('done');
