/**
 * Wrap an export route handler so a throw mid-generation becomes a readable
 * plain-text 500 instead of an empty body. Every /api/export/* route returns
 * through this: `downloadBlob` surfaces the response text as the on-screen
 * error, so an empty body would leave the user with nothing but a status code
 * — which is exactly how the Valuation export's reserved-sheet-name crash
 * presented as "the button does nothing".
 */
export async function guardedExport(
  tag: string,
  build: () => Promise<Response>,
): Promise<Response> {
  try {
    return await build();
  } catch (err) {
    console.error(`[${tag}] export failed:`, err);
    const detail = err instanceof Error && err.message ? `: ${err.message}` : "";
    return new Response(`Export failed${detail}`, { status: 500 });
  }
}

/** Trigger a file download from a fetch response. */
export async function downloadBlob(
  url: string,
  filename: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<void> {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Routes answer failures as plain text or as JSON `{ error }` — show the
    // human-readable part either way, never a raw JSON blob.
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (parsed && typeof parsed.error === "string") message = parsed.error;
    } catch {
      /* plain-text body */
    }
    throw new Error(message || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
