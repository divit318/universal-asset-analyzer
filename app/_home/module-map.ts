/**
 * id → component. The only place the registry's metadata meets React.
 *
 * Kept out of `lib/home/registry.ts` on purpose: a React import there would
 * make the registry client-only, and the server, the layout validator, and the
 * unit tests all need to read module metadata without pulling in a component
 * tree. `validateHomeComposition(HOME_LAYOUT, HOME_MODULE_IDS)` (tests/home-registry.test.ts)
 * is what keeps this map and the registry in lockstep — a module registered
 * without a component, or a component without a registration, fails CI.
 */

import type { ComponentType } from "react";
import type { HomeModuleId } from "@/lib/home/types";

import { TodaysBriefModule } from "./modules/todays-brief";
import { AiInvestmentBriefModule } from "./modules/ai-investment-brief";
import { RecommendedActionsModule } from "./modules/recommended-actions";
import { PortfolioPulseModule } from "./modules/portfolio-pulse";
import { MarketIntelligenceModule } from "./modules/market-intelligence";
import { OpportunityFeedModule } from "./modules/opportunity-feed";
import { WatchlistIntelligenceModule } from "./modules/watchlist-intelligence";
import { UpcomingEventsModule } from "./modules/upcoming-events";
import { PortfolioPerformanceModule } from "./modules/portfolio-performance";
import { ContinueModule } from "./modules/continue";

/**
 * Props the page passes down from the layout config. A module may ignore them
 * — only collapsible modules read them — but none of them may *source* them,
 * because a module does not get to decide its own collapse behaviour.
 */
export interface HomeModuleProps {
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export const HOME_MODULES: Record<HomeModuleId, ComponentType<HomeModuleProps>> = {
  "todays-brief": TodaysBriefModule,
  "ai-investment-brief": AiInvestmentBriefModule,
  "recommended-actions": RecommendedActionsModule,
  "portfolio-pulse": PortfolioPulseModule,
  "market-intelligence": MarketIntelligenceModule,
  "opportunity-feed": OpportunityFeedModule,
  "watchlist-intelligence": WatchlistIntelligenceModule,
  "upcoming-events": UpcomingEventsModule,
  "portfolio-performance": PortfolioPerformanceModule,
  continue: ContinueModule,
};

export const HOME_MODULE_IDS = Object.keys(HOME_MODULES) as HomeModuleId[];
