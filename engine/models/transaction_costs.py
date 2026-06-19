"""
Transaction cost model — NSE equity delivery charges (2025 schedule).

Charges per side:
  Brokerage:     0% (Zerodha delivery)
  STT:           0.1% on sell side only
  Exchange levy: 0.00345% per side (NSE)
  SEBI charges:  0.0001% per side
  GST:           18% on (brokerage + exchange levy + SEBI)
  Stamp duty:    0.015% on buy side only

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
