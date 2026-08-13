"use client";

/**
 * Update-from-screenshot dialog — the whole flow in one place:
 *
 *   upload screenshots → UAA reads them → review the reconciliation → confirm
 *
 * Nothing is written until the user confirms: the extract call returns a
 * preview (per-security status, the exact write each row would perform, and
 * every validation flag), and only the rows the user leaves checked are sent
 * to /api/portfolio/import/apply. Destructive rows (rebaseline over real
 * transaction history, deletions) are never pre-checked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { useToast } from "@/app/_components/toast";
import { Badge, Button } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type {
  ImportApplyAction,
  ImportPreview,
  ReconciliationRow,
} from "@/lib/portfolio/import/types";

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";
const MAX_IMAGES = 6;

type Completeness = "complete" | "partial" | "unsure";
type Step = "upload" | "review";

const COMPLETENESS_OPTIONS: { id: Completeness; label: string; detail: string }[] = [
  { id: "complete", label: "My entire portfolio", detail: "Holdings not visible can be flagged as sold" },
  { id: "partial", label: "Only some holdings", detail: "Everything not shown is left untouched" },
  { id: "unsure", label: "Not sure", detail: "Treated as partial — nothing is ever deleted" },
];

function fmtQty(n: number): string {
  return Number(n.toFixed(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function statusBadge(row: ReconciliationRow) {
  switch (row.kind) {
    case "new":
      return <Badge variant="brand">New</Badge>;
    case "increase":
      return <Badge variant="positive">Increased</Badge>;
    case "decrease":
      return <Badge variant="warning">Decreased</Badge>;
    case "cost-change":
      return <Badge variant="warning">Cost change</Badge>;
    case "unchanged":
      return <Badge variant="neutral">Unchanged</Badge>;
    case "missing":
      return row.action === "remove" ? <Badge variant="negative">Not in screenshot</Badge> : <Badge variant="neutral">Not shown</Badge>;
    case "conflict":
      return <Badge variant="negative">Needs review</Badge>;
  }
}

/** old → new rendering for a numeric field, or just the value when unchanged/new. */
function Delta({ prev, next, format }: { prev: number | null | undefined; next: number | null | undefined; format: (n: number) => string }) {
  const changed = prev != null && next != null && Math.abs(prev - next) > 1e-9;
  if (next == null && prev == null) return <span className="text-muted/60">—</span>;
  if (changed) {
    return (
      <span>
        <span className="text-muted/70 line-through">{format(prev as number)}</span>{" "}
        <span className="font-medium text-foreground">{format(next as number)}</span>
      </span>
    );
  }
  const v = next ?? prev;
  return <span>{v != null ? format(v) : "—"}</span>;
}

export function ImportScreenshotDialog({ open, onClose, onApplied }: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful apply so the page refetches the report. */
  onApplied: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [completeness, setCompleteness] = useState<Completeness>("unsure");
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const reset = useCallback(() => {
    setStep("upload");
    setFiles([]);
    setPreviewUrls((urls) => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    setCompleteness("unsure");
    setExtracting(false);
    setApplying(false);
    setError(null);
    setPreview(null);
    setSelected({});
  }, []);

  // Reset on close so reopening never shows a stale preview of old screenshots.
  /* eslint-disable react-hooks/set-state-in-effect -- syncing local form state
     to `open`, an external prop the parent controls, not derivable at render
     time (same pattern as add-holding-dialog). */
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function addFiles(list: FileList | File[]) {
    const next = [...files];
    const nextUrls = [...previewUrls];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/")) continue;
      if (next.length >= MAX_IMAGES) break;
      next.push(f);
      nextUrls.push(URL.createObjectURL(f));
    }
    setFiles(next);
    setPreviewUrls(nextUrls);
    setError(null);
  }

  function removeFile(i: number) {
    URL.revokeObjectURL(previewUrls[i]);
    setFiles(files.filter((_, j) => j !== i));
    setPreviewUrls(previewUrls.filter((_, j) => j !== i));
  }

  async function extract() {
    if (files.length === 0) return;
    setExtracting(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("images", f);
      form.append("complete", completeness);
      const res = await fetch("/api/portfolio/import/extract", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to read the screenshots");
      const p = json as ImportPreview;
      setPreview(p);
      setSelected(Object.fromEntries(p.rows.map((r) => [r.key, r.defaultSelected])));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read the screenshots");
    } finally {
      setExtracting(false);
    }
  }

  const actionable = useMemo(
    () => (preview?.rows ?? []).filter((r) => r.action !== "none"),
    [preview],
  );
  const selectedRows = actionable.filter((r) => selected[r.key]);

  async function apply() {
    if (!preview || selectedRows.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const actions: ImportApplyAction[] = selectedRows.map((r) => ({
        action: r.action as ImportApplyAction["action"],
        symbol: r.symbol as string,
        name: r.name,
        assetClass: r.assetClass,
        currency: r.currency,
        quantity: r.extracted?.quantity ?? undefined,
        avgCost: r.extracted?.avgCost ?? undefined,
        delta: r.delta ?? undefined,
        confidence: r.extracted?.confidence ?? "low",
        costAssumed: r.issues.some((i) => i.code === "cost-assumed") || undefined,
      }));
      const res = await fetch("/api/portfolio/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions, confirmedComplete: completeness === "complete" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update the portfolio");
      const parts: string[] = [];
      if (json.added) parts.push(`${json.added} added`);
      if (json.updated) parts.push(`${json.updated} updated`);
      if (json.removed) parts.push(`${json.removed} removed`);
      toast(`Portfolio updated — ${parts.join(", ") || "no changes"}`);
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update the portfolio");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Update from screenshot" className="max-w-3xl">
      {step === "upload" ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted">
            Upload screenshot(s) of your brokerage&apos;s holdings page. UAA reads every visible
            position, checks the numbers reconcile, and shows you exactly what would change —
            nothing is saved until you confirm.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragOver ? "border-brand bg-brand/5" : "border-border bg-surface-2/40"
            }`}
          >
            <p className="text-sm text-muted">Drag screenshots here, or</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              Choose images…
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            />
            <p className="text-[11px] text-muted/70">
              Up to {MAX_IMAGES} images (PNG/JPEG/WebP), 5MB each. Multiple screenshots of one
              account are combined and de-duplicated.
            </p>
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previewUrls.map((url, i) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, next/image adds nothing */}
                  <img src={url} alt={files[i]?.name ?? `Screenshot ${i + 1}`} className="h-20 w-28 rounded-lg border border-border object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove ${files[i]?.name ?? `screenshot ${i + 1}`}`}
                    onClick={() => removeFile(i)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[10px] text-muted hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Do these screenshots show your entire portfolio?</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {COMPLETENESS_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCompleteness(opt.id)}
                  aria-pressed={completeness === opt.id}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    completeness === opt.id
                      ? "border-brand bg-brand/10"
                      : "border-border hover:border-brand/40"
                  }`}
                >
                  <span className="block text-xs font-semibold text-foreground">{opt.label}</span>
                  <span className="block text-[11px] leading-snug text-muted">{opt.detail}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-negative">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" disabled={files.length === 0 || extracting} onClick={extract}>
              {extracting ? "Reading screenshots…" : "Read screenshots"}
            </Button>
          </div>
          {extracting && (
            <p className="text-[11px] text-muted/70">
              The model is transcribing and cross-checking every position — usually 10–30 seconds.
            </p>
          )}
        </div>
      ) : preview ? (
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-semibold text-foreground">
              We found {preview.rows.filter((r) => r.extracted !== null).length} holdings
            </span>
            {preview.extraction.brokerage && <span>· {preview.extraction.brokerage}</span>}
            {preview.totals.statedTotal !== null && (
              <span>· stated total {formatCurrency(preview.totals.statedTotal)}</span>
            )}
            {preview.totals.withinTolerance === true && (
              <span className="text-positive">· positions reconcile with the total ✓</span>
            )}
            {preview.totals.withinTolerance === false && (
              <span className="text-warning">· positions do NOT reconcile with the stated total</span>
            )}
            <span className="text-muted/60">· read by {preview.extraction.model}</span>
          </div>

          {completeness !== "complete" && preview.extraction.appearsComplete === true && (
            <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[11px] leading-relaxed text-muted">
              These screenshots look like they show the entire portfolio
              {preview.extraction.completenessReason ? ` (${preview.extraction.completenessReason.replace(/\.$/, "")})` : ""}.
              Holdings not visible are still left untouched — go back and mark the upload as
              &ldquo;My entire portfolio&rdquo; if you want missing positions flagged as sold.
            </p>
          )}

          {preview.extraction.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2">
              {preview.extraction.warnings.map((w, i) => (
                <p key={i} className="text-[11px] leading-relaxed text-warning">{w}</p>
              ))}
            </div>
          )}

          {/* Reconciliation table */}
          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-3 py-2" aria-label="Apply" />
                  <th className="px-2 py-2">Security</th>
                  <th className="px-2 py-2 text-right">Quantity</th>
                  <th className="px-2 py-2 text-right">Avg cost</th>
                  <th className="px-2 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const actionable = row.action !== "none";
                  const checked = actionable && !!selected[row.key];
                  return (
                    <tr key={row.key} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2">
                        {actionable && (
                          <input
                            type="checkbox"
                            aria-label={`Apply change for ${row.name}`}
                            checked={checked}
                            onChange={(e) => setSelected({ ...selected, [row.key]: e.target.checked })}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-medium text-foreground">{row.symbol ?? row.name}</span>
                        {row.symbol && row.name !== row.symbol && (
                          <span className="block max-w-[14rem] truncate text-[11px] text-muted">{row.name}</span>
                        )}
                        {row.issues.map((iss, i) => (
                          <span
                            key={i}
                            className={`mt-0.5 block max-w-md text-[11px] leading-snug ${
                              iss.severity === "error" ? "text-negative" : iss.severity === "warning" ? "text-warning" : "text-muted/70"
                            }`}
                          >
                            {iss.message}
                          </span>
                        ))}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <Delta prev={row.existing?.quantity} next={row.extracted?.quantity} format={fmtQty} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <Delta prev={row.existing?.avgCost} next={row.extracted?.avgCost} format={formatCurrency} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {row.extracted?.marketValue != null ? formatCurrency(row.extracted.marketValue) : <span className="text-muted/60">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{statusBadge(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Change summary */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {preview.changeCount === 0
                ? "No changes detected — your portfolio already matches the screenshots."
                : `${preview.changeCount} change${preview.changeCount === 1 ? "" : "s"} detected · ${selectedRows.length} selected`}
              {preview.needsReviewCount > 0 && (
                <span className="text-warning"> · {preview.needsReviewCount} need{preview.needsReviewCount === 1 ? "s" : ""} review</span>
              )}
            </p>
            {selectedRows.some((r) => r.destructive) && (
              <p className="text-[11px] font-medium text-negative">
                Selected changes include replacing or deleting recorded transaction history.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-negative">{error}</p>}

          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => { setStep("upload"); setError(null); }}>
              ← Back
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                type="button"
                variant="primary"
                disabled={applying || selectedRows.length === 0}
                onClick={apply}
              >
                {applying
                  ? "Updating…"
                  : `Confirm portfolio update${selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
