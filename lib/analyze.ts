import type { AnalysisInsight, AnalysisResult, Asset, AssetKind } from "./types";
import { inspectBinary, inspectImage, inspectText } from "./inspect";

const KB = 1024;

/** Map a MIME type to a coarse asset kind. */
export function classify(mimeType: string): AssetKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return "text";
  }
  if (mimeType.length > 0) return "binary";
  return "unknown";
}

export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

/** Kind-specific content insights derived from the asset's raw bytes. */
function contentInsights(kind: AssetKind, bytes: Uint8Array): AnalysisInsight[] {
  switch (kind) {
    case "text":
      return inspectText(bytes);
    case "image":
      return inspectImage(bytes);
    case "binary":
      return inspectBinary(bytes);
    default:
      return [];
  }
}

/**
 * Produce a structured analysis for an asset.
 *
 * Always reports metadata insights. When `bytes` are provided, kind-specific
 * content analysis (image dimensions, text stats, binary entropy) is appended.
 */
export function analyze(asset: Asset, bytes?: Uint8Array): AnalysisResult {
  const insights: AnalysisInsight[] = [
    { label: "Kind", value: asset.kind },
    { label: "MIME type", value: asset.mimeType || "—" },
    { label: "Size", value: formatBytes(asset.size) },
  ];

  if (bytes) {
    insights.push(...contentInsights(asset.kind, bytes));
  }

  return {
    asset,
    insights,
    analyzedAt: new Date().toISOString(),
  };
}
