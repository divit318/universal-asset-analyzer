"use client";

import { Badge, DataTable, type DataTableColumn } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL, type Holding } from "@/lib/portfolio/model/types";

/**
 * Read-only holdings list for a NON-default portfolio. Deliberately not
 * HoldingsPanel: that component's manage/trade actions call routes that write
 * to whatever portfolio the route defaults to — rendering it here would put a
 * "Manage position…" button on one book that silently edits another. View-only
 * until the write path is portfolio-aware end to end.
 */
export function ReadOnlyHoldings({ holdings, baseCurrency }: { holdings: Holding[]; baseCurrency: string }) {
  const columns: DataTableColumn<Holding>[] = [
    {
      key: "symbol",
      label: "Holding",
      firstSortDir: "asc",
      render: (h) => (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{h.symbol ?? h.name}</span>
          <span className="max-w-[16rem] truncate text-[11px] text-muted">{h.name}</span>
        </span>
      ),
      sortValue: (h) => h.symbol ?? h.name,
    },
    {
      key: "class",
      label: "Class",
      render: (h) => <Badge variant="neutral">{PORTFOLIO_CLASS_LABEL[h.assetClass] ?? h.assetClass}</Badge>,
      sortValue: (h) => h.assetClass,
      hideBelow: "sm",
    },
    {
      key: "quantity",
      label: "Quantity",
      numeric: true,
      render: (h) => (h.assetClass === "cash" ? "—" : h.quantity.toLocaleString("en-US")),
      sortValue: (h) => (h.assetClass === "cash" ? null : h.quantity),
      hideBelow: "md",
    },
    {
      key: "value",
      label: "Value",
      numeric: true,
      render: (h) => formatCurrency(h.valuation.valueBase, baseCurrency),
      sortValue: (h) => h.valuation.valueBase,
    },
    {
      key: "weight",
      label: "Weight",
      numeric: true,
      render: (h) => `${h.weight.toFixed(1)}%`,
      sortValue: (h) => h.weight,
    },
  ];

  return (
    <DataTable
      rows={holdings}
      columns={columns}
      rowKey={(h) => h.id}
      defaultSortKey="value"
      defaultSortDir="desc"
      label="Holdings (view only)"
    />
  );
}
