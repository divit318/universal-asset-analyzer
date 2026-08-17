/**
 * Exposure — public entry point.
 *
 * Two stages, deliberately separate endpoints:
 *
 *   Stage 1 (`getExposureModel`) reads the already-cached portfolio report and
 *   the fund constituents the Intelligence tab has usually just fetched. It is
 *   the whole feature minus drivers: every trace, every fan-out, every blast
 *   radius, every finding.
 *
 *   Stage 2 (`getExposureDrivers`) resolves per-issuer industries and probes the
 *   reference funds — tens of provider round-trips that have no business
 *   blocking the first paint. The page is fully usable before it lands, and
 *   lights up when it does.
 *
 * Both go through the platform data layer. There is no cache in this module,
 * and there must never be one: cache policy lives in lib/platform/registry.ts.
 */

import { getDataset } from "../platform";
import { getPortfolioReport } from "../portfolio/report";
import { buildExposureModel } from "./model";
import { buildExposureDrivers } from "./drivers";
import type { ExposureDrivers, ExposureModel } from "./types";

export async function getExposureModel(
  opts: { baseCurrency?: string; portfolioId?: number } = {},
): Promise<ExposureModel> {
  const { data } = await getDataset(
    "exposureModel",
    { portfolioId: opts.portfolioId ?? 1, baseCurrency: opts.baseCurrency ?? "USD" },
    async () => {
      const report = await getPortfolioReport({
        baseCurrency: opts.baseCurrency,
        portfolioId: opts.portfolioId,
      });
      return buildExposureModel(report);
    },
    { timeoutMs: 60_000 },
  );
  return data;
}

export async function getExposureDrivers(
  opts: { baseCurrency?: string; portfolioId?: number } = {},
): Promise<ExposureDrivers> {
  const { data } = await getDataset(
    "exposureDrivers",
    { portfolioId: opts.portfolioId ?? 1, baseCurrency: opts.baseCurrency ?? "USD" },
    async () => buildExposureDrivers(await getExposureModel(opts)),
    { timeoutMs: 90_000 },
  );
  return data;
}

export { buildExposureModel } from "./model";
export { buildExposureDrivers, assembleDrivers } from "./drivers";
export * from "./query";
export * from "./types";
