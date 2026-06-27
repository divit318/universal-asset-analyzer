"""
Transaction cost model — NSE equity delivery charges (2025 schedule) and
US equity charges (SEC fee, FINRA TAF, bid-ask spread by market cap tier).

NSE charges per side:
  Brokerage:     0% (Zerodha delivery)
  STT:           0.1% on sell side only
  Exchange levy: 0.00345% per side (NSE)
  SEBI charges:  0.0001% per side
  GST:           18% on (brokerage + exchange levy + SEBI)
  Stamp duty:    0.015% on buy side only

US charges per side:
  SEC fee:       $0.0000278 per $ sold (sell side only, Section 31)
  FINRA TAF:     $0.000119 per share sold (sell side only, capped $5.95)
  Bid-ask spread: estimated by market cap tier (large/mid/small)

Round-trip cost is applied to every rebalance trade.
"""

from __future__ import annotations

import dataclasses


@dataclasses.dataclass
class TransactionCostModel:
    brokerage_pct:   float = 0.0       # Zerodha delivery = 0
    stt_sell_pct:    float = 0.001     # 0.1% sell only
    exchange_pct:    float = 0.0000345 # 0.00345% per side
    sebi_pct:        float = 0.000001  # 0.0001% per side
    gst_rate:        float = 0.18      # 18% on brokerage+exchange+sebi
    stamp_buy_pct:   float = 0.00015   # 0.015% buy only

    def buy_cost(self, value: float) -> float:
        """Cost of buying `value` worth of stock."""
        statutory = self.exchange_pct + self.sebi_pct + self.brokerage_pct
        gst = statutory * self.gst_rate
        return value * (statutory + gst + self.stamp_buy_pct)

    def sell_cost(self, value: float) -> float:
        """Cost of selling `value` worth of stock."""
        statutory = self.exchange_pct + self.sebi_pct + self.brokerage_pct
        gst = statutory * self.gst_rate
        return value * (statutory + gst + self.stt_sell_pct)

    def round_trip_cost(self, value: float) -> float:
        """Total cost of buying then selling `value`."""
        return self.buy_cost(value) + self.sell_cost(value)

    def round_trip_pct(self) -> float:
        """Round-trip cost as fraction of trade value (1.0 = 100%)."""
        return self.round_trip_cost(1.0)

    def buy_pct(self) -> float:
        return self.buy_cost(1.0)

    def sell_pct(self) -> float:
        return self.sell_cost(1.0)


# Default instance — import and use directly
NSE_COSTS = TransactionCostModel()


@dataclasses.dataclass
class USTransactionCostModel:
    """
    US equity transaction costs (2025 schedule, assumes retail DMA execution).

    SEC fee:    0.0000278 per $ of sale proceeds (sell only)
    FINRA TAF:  0.000119 per share sold, capped at $5.95 (sell only, price-based conversion)
    Bid-ask:    estimated half-spread as fraction of price, tiered by market cap:
                large (>$10B):  0.0005  (0.05%)
                mid ($2B-$10B): 0.001   (0.10%)
                small (<$2B):   0.002   (0.20%)

    market_cap_tier: "large" | "mid" | "small" — set at construction time or per-call.
    avg_price:       used to convert FINRA TAF per-share to per-dollar fraction.
    """
    sec_fee_pct:    float = 0.0000278   # per $ sold
    finra_taf_per_share: float = 0.000119  # per share sold
    avg_price:      float = 50.0        # fallback price for FINRA TAF conversion
    market_cap_tier: str  = "large"     # "large" | "mid" | "small"

    _BID_ASK_HALF: dict[str, float] = dataclasses.field(
        default_factory=lambda: {"large": 0.0005, "mid": 0.001, "small": 0.002}
    )

    def _half_spread(self) -> float:
        return self._BID_ASK_HALF.get(self.market_cap_tier, 0.001)

    def _finra_taf_pct(self) -> float:
        """Convert per-share TAF to per-dollar fraction using avg_price."""
        return self.finra_taf_per_share / max(self.avg_price, 1.0)

    def buy_cost(self, value: float) -> float:
        """Crossing half-spread on buy."""
        return value * self._half_spread()

    def sell_cost(self, value: float) -> float:
        """SEC fee + FINRA TAF + half-spread on sell."""
        return value * (self.sec_fee_pct + self._finra_taf_pct() + self._half_spread())

    def round_trip_cost(self, value: float) -> float:
        return self.buy_cost(value) + self.sell_cost(value)

    def round_trip_pct(self) -> float:
        return self.round_trip_cost(1.0)

    def buy_pct(self) -> float:
        return self.buy_cost(1.0)

    def sell_pct(self) -> float:
        return self.sell_cost(1.0)


def get_us_costs(market_cap: float | None = None, avg_price: float = 50.0) -> USTransactionCostModel:
    """
    Return a USTransactionCostModel with the correct market cap tier.
    market_cap in USD absolute (e.g. 5e9 = $5B).
    """
    if market_cap is None:
        tier = "large"
    elif market_cap >= 10e9:
        tier = "large"
    elif market_cap >= 2e9:
        tier = "mid"
    else:
        tier = "small"
    return USTransactionCostModel(avg_price=avg_price, market_cap_tier=tier)


US_COSTS = USTransactionCostModel()  # default large-cap instance
