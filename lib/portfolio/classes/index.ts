/**
 * Registers every portfolio asset class.
 *
 * Importing this module is what populates the adapter registry. lib/portfolio/
 * model/holding.ts imports it, so any consumer of the model gets all twelve
 * classes without having to know they exist.
 *
 * ADDING AN ASSET CLASS: write one file here, import it below. That is the entire
 * checklist. No engine, route, page or type union outside lib/portfolio/model/
 * should need to change — if one does, the class needed something the
 * PortfolioClassAdapter interface doesn't expose, and the fix belongs there.
 */

import "./equity";
import "./etf";
import "./reit";
import "./bond";
import "./crypto";
import "./commodity";
import "./forex";
import "./cash";
import "./real-estate";
import "./private-market";
import "./alternative";
import "./structured-product";

export { getClassAdapter, hasClassAdapter, listClassAdapters } from "../model/adapter";
