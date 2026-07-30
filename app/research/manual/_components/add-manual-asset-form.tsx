"use client";

import { useEffect, useState } from "react";
import { Button, DateInput, Field, Input } from "@/app/_components/ui";
import { DataProvenance } from "@/app/_components/data-provenance";
import type { ManualAssetCategory, StructuredProductType } from "@/lib/types";
import type { RealEstateLookupResult, RealEstateSearchReason } from "@/lib/rentcast";
import type { FormDFiling, FormDDetails } from "@/lib/edgar";

const CATEGORY_LABEL: Record<ManualAssetCategory, string> = {
  real_estate: "Real Estate",
  private_market: "Private Markets",
  alternative: "Alternatives",
  structured_product: "Structured Product",
};

const PRODUCT_TYPE_LABEL: Record<StructuredProductType, string> = {
  barrier_reverse_convertible: "Barrier Reverse Convertible",
  principal_protected_note: "Principal Protected Note",
  autocallable: "Autocallable",
  other: "Other",
};

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

export function AddManualAssetForm({
  onCreated,
  initialCategory,
  initialQuery,
}: {
  onCreated: (id: string) => void;
  /** Pre-selects the category and, paired with initialQuery, auto-runs that category's search on mount — used when arriving here from the Research Hub's Real Estate/Private Markets search mode instead of the blank "+ Add Manual Asset" entry point. */
  initialCategory?: ManualAssetCategory;
  initialQuery?: string;
}) {
  const [category, setCategory] = useState<ManualAssetCategory>(initialCategory ?? "real_estate");
  const [name, setName] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [currentValueAsOf, setCurrentValueAsOf] = useState("");
  const [notes, setNotes] = useState("");

  const [propertyType, setPropertyType] = useState("");
  const [address, setAddress] = useState("");
  const [annualRentalIncome, setAnnualRentalIncome] = useState("");
  const [annualExpenses, setAnnualExpenses] = useState("");
  const [outstandingMortgage, setOutstandingMortgage] = useState("");
  const [mortgageRatePercent, setMortgageRatePercent] = useState("");
  const [addressSearching, setAddressSearching] = useState(false);
  const [addressSearchStatus, setAddressSearchStatus] = useState<"idle" | "found" | RealEstateSearchReason>("idle");
  const [addressSearchAsOf, setAddressSearchAsOf] = useState<number | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [round, setRound] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");
  const [lastRoundValuation, setLastRoundValuation] = useState("");
  const [companySearching, setCompanySearching] = useState(false);
  const [companySearchStatus, setCompanySearchStatus] = useState<"idle" | "results" | "not_found" | "error">("idle");
  const [companyResults, setCompanyResults] = useState<FormDFiling[]>([]);
  const [selectedFiling, setSelectedFiling] = useState<FormDFiling | null>(null);
  const [selectedFilingDetails, setSelectedFilingDetails] = useState<FormDDetails | null>(null);
  const [filingDetailsLoading, setFilingDetailsLoading] = useState(false);

  const [subcategory, setSubcategory] = useState("");
  const [condition, setCondition] = useState("");
  const [provenance, setProvenance] = useState("");

  const [productType, setProductType] = useState<StructuredProductType>("barrier_reverse_convertible");
  const [underlyings, setUnderlyings] = useState<{ symbol: string; level: string }[]>([{ symbol: "", level: "" }]);
  const [barrierPercent, setBarrierPercent] = useState("");
  const [couponRatePercent, setCouponRatePercent] = useState("");
  const [participationRatePercent, setParticipationRatePercent] = useState("");
  const [principalProtectionPercent, setPrincipalProtectionPercent] = useState("");
  const [maturityDate, setMaturityDate] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateUnderlying(index: number, field: "symbol" | "level", value: string) {
    setUnderlyings((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  /**
   * Search-first entry for Real Estate: tries to auto-fill property type,
   * current value, and rental income from a free RentCast lookup before the
   * user resorts to typing everything in by hand. Every outcome here (found,
   * not found, not configured, or a network error) still leaves the form
   * fully manual-editable — this only ever pre-fills, never blocks.
   */
  async function searchAddress(addressOverride?: string) {
    const query = (addressOverride ?? address).trim();
    if (!query) return;
    setAddressSearching(true);
    setAddressSearchStatus("idle");
    try {
      const res = await fetch(`/api/real-estate/search?address=${encodeURIComponent(query)}`);
      const json = (await res.json()) as { result: RealEstateLookupResult | null; asOf: number | null; reason: RealEstateSearchReason | null };
      if (json.result) {
        const r = json.result;
        setAddress(r.address);
        if (r.propertyType) setPropertyType(r.propertyType);
        if (r.estimatedValue != null) {
          setCurrentValue(String(Math.round(r.estimatedValue)));
          setCurrentValueAsOf(new Date().toISOString().slice(0, 10));
        }
        if (r.estimatedMonthlyRent != null) setAnnualRentalIncome(String(Math.round(r.estimatedMonthlyRent * 12)));
        setAddressSearchStatus("found");
        setAddressSearchAsOf(json.asOf ?? Date.now());
      } else {
        setAddressSearchStatus(json.reason ?? "error");
      }
    } catch {
      setAddressSearchStatus("error");
    } finally {
      setAddressSearching(false);
    }
  }

  /**
   * Search-first entry for Private Markets: SEC Form D full-text search
   * confirms a private company is real and surfaces its known private
   * offerings. Unlike Real Estate, this never auto-fills round/ownership/
   * valuation — Form D only discloses capital raised, not a share price or
   * valuation, so those stay manual, informed by the reference context.
   */
  async function searchCompany(companyOverride?: string) {
    const query = (companyOverride ?? companyName).trim();
    if (!query) return;
    setCompanySearching(true);
    setCompanySearchStatus("idle");
    setSelectedFiling(null);
    setSelectedFilingDetails(null);
    try {
      const res = await fetch(`/api/private-markets/search?company=${encodeURIComponent(query)}`);
      const json = (await res.json()) as { filings: FormDFiling[] };
      setCompanyResults(json.filings);
      setCompanySearchStatus(json.filings.length > 0 ? "results" : "not_found");
    } catch {
      setCompanySearchStatus("error");
    } finally {
      setCompanySearching(false);
    }
  }

  async function selectFiling(filing: FormDFiling) {
    setSelectedFiling(filing);
    setCompanyName(filing.entityName);
    setFilingDetailsLoading(true);
    try {
      const res = await fetch(`/api/private-markets/filing?cik=${encodeURIComponent(filing.cik)}&accession=${encodeURIComponent(filing.accessionNumber)}`);
      const json = (await res.json()) as { details: FormDDetails | null };
      setSelectedFilingDetails(json.details);
    } catch {
      setSelectedFilingDetails(null);
    } finally {
      setFilingDetailsLoading(false);
    }
  }

  // Arriving here from the Research Hub's Real Estate/Private Markets search
  // mode: run that category's search immediately instead of making the user
  // retype the same query a second time inside this dialog.
  useEffect(() => {
    if (!initialQuery) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    if (initialCategory === "real_estate") {
      setAddress(initialQuery);
      void searchAddress(initialQuery);
    } else if (initialCategory === "private_market") {
      setCompanyName(initialQuery);
      void searchCompany(initialQuery);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !acquisitionDate || acquisitionCost.trim() === "") {
      setError("Name, acquisition date, and acquisition cost are required");
      return;
    }

    let details: Record<string, unknown>;
    switch (category) {
      case "real_estate":
        if (!propertyType.trim()) {
          setError("Property type is required");
          return;
        }
        details = {
          propertyType,
          address: address.trim() || null,
          annualRentalIncome: num(annualRentalIncome),
          annualExpenses: num(annualExpenses),
          outstandingMortgage: num(outstandingMortgage),
          mortgageRatePercent: num(mortgageRatePercent),
        };
        break;
      case "private_market":
        if (!companyName.trim()) {
          setError("Company name is required");
          return;
        }
        details = {
          companyName,
          round: round.trim() || null,
          ownershipPercent: num(ownershipPercent),
          lastRoundValuation: num(lastRoundValuation),
        };
        break;
      case "alternative":
        if (!subcategory.trim()) {
          setError("Subcategory is required");
          return;
        }
        details = { subcategory, condition: condition.trim() || null, provenance: provenance.trim() || null };
        break;
      case "structured_product": {
        const rows = underlyings.filter((u) => u.symbol.trim() && u.level.trim());
        if (rows.length === 0) {
          setError("At least one underlying symbol + initial level is required");
          return;
        }
        if (!maturityDate) {
          setError("Maturity date is required");
          return;
        }
        details = {
          productType,
          underlyingSymbols: rows.map((u) => u.symbol.trim().toUpperCase()),
          initialLevels: Object.fromEntries(rows.map((u) => [u.symbol.trim().toUpperCase(), Number(u.level)])),
          barrierPercent: num(barrierPercent),
          couponRatePercent: num(couponRatePercent),
          participationRatePercent: num(participationRatePercent),
          principalProtectionPercent: num(principalProtectionPercent),
          maturityDate,
        };
        break;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/manual-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          name: name.trim(),
          acquisitionDate,
          acquisitionCost: Number(acquisitionCost),
          currentValue: num(currentValue),
          currentValueAsOf: currentValueAsOf || null,
          notes: notes.trim() || null,
          details,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create asset");
      onCreated(json.asset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create asset");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Category</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABEL) as ManualAssetCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-control border px-3 py-1.5 text-xs font-medium transition-colors ${
                category === c
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 123 Main St Duplex" />
        </Field>
        <Field label="Acquisition Date">
          <DateInput value={acquisitionDate} onChange={setAcquisitionDate} />
        </Field>
        <Field label="Acquisition Cost ($)">
          <Input type="number" value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Current Value ($)" hint="Optional — your own estimate">
          <Input type="number" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Current Value As Of" hint="Optional">
          <DateInput value={currentValueAsOf} onChange={setCurrentValueAsOf} />
        </Field>
      </div>

      {category === "real_estate" && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Field label="Address" hint="Search to auto-fill property type, estimated value & rent — or just type it and fill in the rest by hand">
            <div className="flex gap-2">
              <Input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setAddressSearchStatus("idle");
                }}
                placeholder="123 Main St, Austin, TX 78701"
              />
              <Button type="button" variant="secondary" onClick={() => searchAddress()} disabled={addressSearching || !address.trim()}>
                {addressSearching ? "Searching…" : "Search"}
              </Button>
            </div>
          </Field>

          {addressSearchStatus === "found" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-positive/30 bg-positive/8 px-3 py-2 text-xs text-positive">
              <span>Found — property type, estimated value, and rent estimate filled in below. Review before saving.</span>
              {addressSearchAsOf != null && <DataProvenance source="rentcast" asOf={addressSearchAsOf} ttlHours={24 * 30} />}
            </div>
          )}
          {addressSearchStatus === "not_found" && (
            <p className="text-xs text-muted">No automatic match for this address — continuing with manual entry below.</p>
          )}
          {addressSearchStatus === "not_configured" && (
            <p className="text-xs text-muted">Automatic lookup isn&apos;t set up yet (no RentCast API key configured) — continuing with manual entry below.</p>
          )}
          {addressSearchStatus === "error" && (
            <p className="text-xs text-muted">Lookup failed — continuing with manual entry below.</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Property Type">
              <Input value={propertyType} onChange={(e) => setPropertyType(e.target.value)} placeholder="e.g. Single-family rental" />
            </Field>
            <Field label="Annual Rental Income ($)" hint="Optional">
              <Input type="number" value={annualRentalIncome} onChange={(e) => setAnnualRentalIncome(e.target.value)} />
            </Field>
            <Field label="Annual Expenses ($)" hint="Optional">
              <Input type="number" value={annualExpenses} onChange={(e) => setAnnualExpenses(e.target.value)} />
            </Field>
            <Field label="Outstanding Mortgage ($)" hint="Optional">
              <Input type="number" value={outstandingMortgage} onChange={(e) => setOutstandingMortgage(e.target.value)} />
            </Field>
            <Field label="Mortgage Rate (%)" hint="Optional">
              <Input type="number" step="0.01" value={mortgageRatePercent} onChange={(e) => setMortgageRatePercent(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {category === "private_market" && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Field label="Company Name" hint="Search SEC Form D filings to confirm the entity and see any known private offerings — or just type it">
            <div className="flex gap-2">
              <Input
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  setCompanySearchStatus("idle");
                  setSelectedFiling(null);
                  setSelectedFilingDetails(null);
                }}
                placeholder="e.g. Acme Robotics"
              />
              <Button type="button" variant="secondary" onClick={() => searchCompany()} disabled={companySearching || !companyName.trim()}>
                {companySearching ? "Searching…" : "Search SEC"}
              </Button>
            </div>
          </Field>

          {companySearchStatus === "results" && !selectedFiling && (
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-2">
              <p className="px-1 text-[10px] uppercase tracking-wide text-muted">SEC Form D filings — select one to confirm</p>
              {companyResults.map((f) => (
                <button
                  key={`${f.cik}-${f.accessionNumber}`}
                  type="button"
                  onClick={() => selectFiling(f)}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface"
                >
                  <span className="truncate">{f.entityName}</span>
                  <span className="shrink-0 text-muted">{f.form} · {f.filedDate}</span>
                </button>
              ))}
            </div>
          )}
          {companySearchStatus === "not_found" && (
            <p className="text-xs text-muted">No SEC Form D filings found under this name — common for many private companies (e.g. raised via an SPV) — continuing with manual entry.</p>
          )}
          {companySearchStatus === "error" && (
            <p className="text-xs text-muted">Lookup failed — continuing with manual entry.</p>
          )}
          {selectedFiling && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-positive/30 bg-positive/8 px-3 py-2 text-xs text-positive">
              <span>
                {filingDetailsLoading
                  ? "Loading filing details…"
                  : selectedFilingDetails
                    ? `SEC Form D filed ${selectedFilingDetails.dateOfFirstSale ?? selectedFiling.filedDate}${selectedFilingDetails.totalAmountSold != null ? ` — $${selectedFilingDetails.totalAmountSold.toLocaleString()} raised` : ""} — reference only, not a valuation. Enter round/ownership/valuation below from what you know.`
                    : `SEC Form D on file (${selectedFiling.filedDate}) — details unavailable.`}
              </span>
              {/* A permanent historical filing date isn't "stale" the way a live quote is — a huge TTL keeps the freshness dot from misreading age as untrustworthiness. */}
              <DataProvenance source="sec_edgar" asOf={selectedFiling.filedDate} ttlHours={24 * 365 * 50} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Round" hint="Optional, e.g. Series B">
              <Input value={round} onChange={(e) => setRound(e.target.value)} />
            </Field>
            <Field label="Ownership (%)" hint="Optional">
              <Input type="number" step="0.01" value={ownershipPercent} onChange={(e) => setOwnershipPercent(e.target.value)} />
            </Field>
            <Field label="Last Round Valuation ($)" hint="Optional — SEC filings don't disclose valuation, only capital raised">
              <Input type="number" value={lastRoundValuation} onChange={(e) => setLastRoundValuation(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {category === "alternative" && (
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <Field label="Subcategory">
            <Input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="e.g. Wine, Watch, Art" />
          </Field>
          <Field label="Condition" hint="Optional">
            <Input value={condition} onChange={(e) => setCondition(e.target.value)} />
          </Field>
          <Field label="Provenance" hint="Optional">
            <Input value={provenance} onChange={(e) => setProvenance(e.target.value)} />
          </Field>
        </div>
      )}

      {category === "structured_product" && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Field label="Product Type">
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value as StructuredProductType)}
              className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            >
              {(Object.keys(PRODUCT_TYPE_LABEL) as StructuredProductType[]).map((t) => (
                <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Underlyings (symbol + level at issuance)</span>
            {underlyings.map((row, i) => (
              <div key={i} className="flex gap-2">
                <Input value={row.symbol} onChange={(e) => updateUnderlying(i, "symbol", e.target.value)} placeholder="Symbol, e.g. AAPL" />
                <Input type="number" value={row.level} onChange={(e) => updateUnderlying(i, "level", e.target.value)} placeholder="Level at issuance" />
                {underlyings.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setUnderlyings((rows) => rows.filter((_, idx) => idx !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setUnderlyings((rows) => [...rows, { symbol: "", level: "" }])}>
              + Add underlying
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Barrier (%)" hint="Optional">
              <Input type="number" step="0.01" value={barrierPercent} onChange={(e) => setBarrierPercent(e.target.value)} />
            </Field>
            <Field label="Coupon Rate (%/yr)" hint="Optional">
              <Input type="number" step="0.01" value={couponRatePercent} onChange={(e) => setCouponRatePercent(e.target.value)} />
            </Field>
            <Field label="Participation Rate (%)" hint="Optional">
              <Input type="number" step="0.01" value={participationRatePercent} onChange={(e) => setParticipationRatePercent(e.target.value)} />
            </Field>
            <Field label="Principal Protection (%)" hint="Optional">
              <Input type="number" step="0.01" value={principalProtectionPercent} onChange={(e) => setPrincipalProtectionPercent(e.target.value)} />
            </Field>
            <Field label="Maturity Date">
              <DateInput value={maturityDate} onChange={setMaturityDate} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Notes" hint="Optional">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
      </Field>

      {error && <p className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

      <Button type="submit" variant="primary" disabled={submitting} className="self-end">
        {submitting ? "Adding…" : "Add Asset"}
      </Button>
    </form>
  );
}
