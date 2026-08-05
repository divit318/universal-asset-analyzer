/* Runtime verification of engine-math findings. READ-ONLY. */
import { bollingerBands, macd, rsi } from "/Users/divit/universal-asset-analyzer/lib/indicators";
import { blackScholesGreeks } from "/Users/divit/universal-asset-analyzer/lib/black-scholes";

// --- 1. Bollinger: population vs sample std ---
const closes = [100, 102, 98, 101, 99, 103, 97, 104, 96, 105, 100, 102, 98, 101, 99, 103, 97, 104, 96, 105];
const bb = bollingerBands(closes, 20, 2);
const mean = closes.reduce((a, b) => a + b) / 20;
const varP = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
const varS = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / 19;
console.log("[Bollinger] app upper:", bb.upper.at(-1), "| pop-std upper:", mean + 2 * Math.sqrt(varP), "| sample-std upper:", mean + 2 * Math.sqrt(varS));

// --- 2. MACD: null-as-0 in signal line ---
const trend = Array.from({ length: 40 }, (_, i) => 100 + i * 2); // strong uptrend
const m = macd(trend, 12, 26, 9);
console.log("[MACD] first 30 signal values:", m.signal.slice(20, 32).map(v => v == null ? "·" : v.toFixed(2)).join(","));
console.log("[MACD] last macd:", m.macdLine.at(-1)?.toFixed(3), "last signal:", m.signal.at(-1)?.toFixed(3), "(signal should trail but be same order of magnitude)");

// --- 3. Black-Scholes put-call parity: C - P = S - K e^{-rT} ---
const S = 100, K = 100, T = 0.5, r = 0.05, sigma = 0.2;
const call = blackScholesGreeks({ spot: S, strike: K, timeToExpiryYears: T, riskFreeRate: r, impliedVol: sigma, type: "call" } as any);
const put = blackScholesGreeks({ spot: S, strike: K, timeToExpiryYears: T, riskFreeRate: r, impliedVol: sigma, type: "put" } as any);
console.log("[BS] call:", JSON.stringify(call));
console.log("[BS] put:", JSON.stringify(put));
if (call && put) {
  const lhs = (call as any).price - (put as any).price;
  const rhs = S - K * Math.exp(-r * T);
  console.log("[BS] parity C-P =", lhs?.toFixed(4), "vs S-Ke^-rT =", rhs.toFixed(4));
}

// --- 4. RSI all-gains edge ---
const up = Array.from({ length: 30 }, (_, i) => 100 + i);
console.log("[RSI] monotonic up (should be 100):", rsi(up, 14).at(-1));
