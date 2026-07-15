/**
 * Token → sector classification.
 *
 * This is a `reference` source in the Asset Registry's sense: a small, curated
 * table that ships with the app rather than coming off a live feed. Yahoo's
 * crypto endpoint returns price, market cap and supply but carries no sector
 * or category field at all, and the requested Layer 1 / DeFi / AI templates
 * are meaningless without one.
 *
 * A token's *sector* is a slow-moving, structural fact (Solana will not stop
 * being a Layer 1), which is what makes a shipped table defensible here where
 * it would not be for, say, a price. Tokens absent from the table screen as
 * "Other" — they are never guessed at. Extend the table rather than inferring
 * a category from the ticker.
 */

export const CRYPTO_SECTORS = [
  "Layer 1",
  "Layer 2",
  "DeFi",
  "AI",
  "Infrastructure",
  "Exchange",
  "Stablecoin",
  "Meme",
  "Gaming & NFT",
  "Privacy",
  "Store of Value",
  "Other",
] as const;

export type CryptoSector = (typeof CRYPTO_SECTORS)[number];

/** Last time this table was reviewed against the top ~150 tokens by market cap. */
export const CRYPTO_SECTORS_AS_OF = "2026-01";

/** Keyed by the base asset (the part before "-USD" in a Yahoo crypto symbol). */
export const CRYPTO_SECTOR_MAP: Record<string, CryptoSector> = {
  // Store of value
  BTC: "Store of Value",

  // Layer 1
  ETH: "Layer 1",
  SOL: "Layer 1",
  ADA: "Layer 1",
  AVAX: "Layer 1",
  DOT: "Layer 1",
  ATOM: "Layer 1",
  NEAR: "Layer 1",
  APT: "Layer 1",
  SUI: "Layer 1",
  SEI: "Layer 1",
  TON: "Layer 1",
  TRX: "Layer 1",
  ALGO: "Layer 1",
  EGLD: "Layer 1",
  HBAR: "Layer 1",
  ICP: "Layer 1",
  FTM: "Layer 1",
  KAS: "Layer 1",
  TIA: "Layer 1",
  INJ: "Layer 1",
  XLM: "Layer 1",
  XRP: "Layer 1",
  BCH: "Layer 1",
  LTC: "Layer 1",
  ETC: "Layer 1",
  FLOW: "Layer 1",
  MINA: "Layer 1",
  KAVA: "Layer 1",
  ROSE: "Layer 1",
  CFX: "Layer 1",

  // Layer 2 / scaling
  MATIC: "Layer 2",
  POL: "Layer 2",
  ARB: "Layer 2",
  OP: "Layer 2",
  IMX: "Layer 2",
  STRK: "Layer 2",
  MNT: "Layer 2",
  METIS: "Layer 2",
  LRC: "Layer 2",

  // DeFi
  UNI: "DeFi",
  AAVE: "DeFi",
  MKR: "DeFi",
  LDO: "DeFi",
  CRV: "DeFi",
  COMP: "DeFi",
  SNX: "DeFi",
  SUSHI: "DeFi",
  "1INCH": "DeFi",
  DYDX: "DeFi",
  RUNE: "DeFi",
  CAKE: "DeFi",
  PENDLE: "DeFi",
  ENA: "DeFi",
  JUP: "DeFi",
  RPL: "DeFi",
  FXS: "DeFi",
  BAL: "DeFi",
  YFI: "DeFi",

  // AI
  FET: "AI",
  AGIX: "AI",
  OCEAN: "AI",
  RNDR: "AI",
  RENDER: "AI",
  TAO: "AI",
  AKT: "AI",
  WLD: "AI",
  ARKM: "AI",
  AI: "AI",
  NMR: "AI",

  // Infrastructure / oracles / storage / DePIN
  LINK: "Infrastructure",
  FIL: "Infrastructure",
  AR: "Infrastructure",
  GRT: "Infrastructure",
  HNT: "Infrastructure",
  THETA: "Infrastructure",
  QNT: "Infrastructure",
  STX: "Infrastructure",
  CHZ: "Infrastructure",
  ANKR: "Infrastructure",
  STORJ: "Infrastructure",
  IOTA: "Infrastructure",
  VET: "Infrastructure",

  // Exchange tokens
  BNB: "Exchange",
  OKB: "Exchange",
  CRO: "Exchange",
  KCS: "Exchange",
  GT: "Exchange",
  LEO: "Exchange",

  // Stablecoins
  USDT: "Stablecoin",
  USDC: "Stablecoin",
  DAI: "Stablecoin",
  TUSD: "Stablecoin",
  USDE: "Stablecoin",
  FDUSD: "Stablecoin",
  PYUSD: "Stablecoin",

  // Meme
  DOGE: "Meme",
  SHIB: "Meme",
  PEPE: "Meme",
  WIF: "Meme",
  BONK: "Meme",
  FLOKI: "Meme",
  BRETT: "Meme",
  POPCAT: "Meme",

  // Gaming & NFT
  SAND: "Gaming & NFT",
  MANA: "Gaming & NFT",
  AXS: "Gaming & NFT",
  APE: "Gaming & NFT",
  GALA: "Gaming & NFT",
  ENJ: "Gaming & NFT",
  BLUR: "Gaming & NFT",
  PIXEL: "Gaming & NFT",
  BEAM: "Gaming & NFT",

  // Privacy
  XMR: "Privacy",
  ZEC: "Privacy",
  DASH: "Privacy",
  SCRT: "Privacy",
};

/** Base asset for a Yahoo crypto symbol: "BTC-USD" → "BTC". */
export function cryptoBase(symbol: string): string {
  return symbol.toUpperCase().split("-")[0];
}

export function cryptoSector(symbol: string): CryptoSector {
  return CRYPTO_SECTOR_MAP[cryptoBase(symbol)] ?? "Other";
}
