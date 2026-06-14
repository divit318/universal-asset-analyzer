import { NextResponse } from "next/server";
import { analyze, classify } from "@/lib/analyze";
import type { Asset } from "@/lib/types";

/** Reject uploads larger than this to avoid buffering huge payloads. */
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * POST /api/analyze
 * Body: multipart/form-data with a `file` field.
 * Returns the structured AnalysisResult for the uploaded asset.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A `file` field is required" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_BYTES / (1024 * 1024)} MB limit` },
      { status: 413 },
    );
  }

  const asset: Asset = {
    name: file.name,
    mimeType: file.type,
    size: file.size,
    kind: classify(file.type),
  };

  const bytes = new Uint8Array(await file.arrayBuffer());

  return NextResponse.json(analyze(asset, bytes));
}
