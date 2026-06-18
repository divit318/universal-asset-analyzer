import { getHistory } from "@/lib/yahoo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 5);
  const days = Math.min(parseInt(searchParams.get("days") ?? "365", 10), 5 * 365);

  if (!symbols.length) return Response.json({ error: "symbols required" }, { status: 400 });

  const results = await Promise.allSettled(
    symbols.map(async (s) => ({ symbol: s, history: await getHistory(s, days + 10) })),
  );

  const data: Record<string, { date: string; close: number }[]> = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      data[r.value.symbol] = r.value.history.map((p) => ({ date: p.date, close: p.close }));
    }
  }

  return Response.json(data);
}
