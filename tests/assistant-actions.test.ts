import { describe, expect, it, vi } from "vitest";
import { describeMutationResults, executeWatchlistAdds } from "@/app/_components/assistant-actions";

const ok = () => new Response(JSON.stringify({ symbol: "X" }), { status: 201 });
const fail = (error: string, status = 500) => new Response(JSON.stringify({ error }), { status });

describe("executeWatchlistAdds — every write awaited and verified", () => {
  it("reports success only from a 2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const results = await executeWatchlistAdds([{ symbol: "TSLA", name: "Tesla, Inc." }], fetchImpl);
    expect(results).toEqual([{ symbol: "TSLA", name: "Tesla, Inc.", ok: true }]);
    // The server-resolved name is passed through, so the write path performs
    // no second symbol lookup (and stores the verified display name).
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/watchlist",
      expect.objectContaining({ body: JSON.stringify({ symbol: "TSLA", name: "Tesla, Inc." }) }),
    );
  });

  it("a non-2xx response is a failure carrying the API's reason — never claimed as success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail("`symbol` must be a valid ticker (e.g. AAPL)", 400));
    const results = await executeWatchlistAdds([{ symbol: "??", name: "Broken" }], fetchImpl);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("valid ticker");
  });

  it("a network throw is a failure, not an unhandled rejection (old fire-and-forget regression)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const results = await executeWatchlistAdds([{ symbol: "TSLA", name: "Tesla, Inc." }], fetchImpl);
    expect(results[0].ok).toBe(false);
  });

  it("multi-add: each item gets an independent verified result (partial failure preserved)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(fail("database is locked"))
      .mockResolvedValueOnce(ok());
    const results = await executeWatchlistAdds(
      [
        { symbol: "AAPL", name: "Apple Inc." },
        { symbol: "MSFT", name: "Microsoft Corporation" },
        { symbol: "GOOGL", name: "Alphabet Inc." },
      ],
      fetchImpl,
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toBe("database is locked");
  });
});

describe("describeMutationResults — the receipt the user reads", () => {
  it("success names the verified instrument", () => {
    const { text, allFailed } = describeMutationResults([{ symbol: "TSLA", name: "Tesla, Inc.", ok: true }]);
    expect(text).toBe("✓ Added Tesla, Inc. (TSLA) to your Watchlist.");
    expect(allFailed).toBe(false);
  });

  it("failure is explicit and carries the reason", () => {
    const { text, allFailed } = describeMutationResults([
      { symbol: "TSLA", name: "Tesla, Inc.", ok: false, error: "database is locked" },
    ]);
    expect(text).toContain("✗ Couldn't add Tesla, Inc. (TSLA)");
    expect(text).toContain("database is locked");
    expect(allFailed).toBe(true);
  });

  it("partial multi-add is NEVER summarized as a success — one verified line per asset", () => {
    const { text, allFailed } = describeMutationResults([
      { symbol: "AAPL", name: "Apple Inc.", ok: true },
      { symbol: "MSFT", name: "Microsoft Corporation", ok: false },
      { symbol: "GOOGL", name: "Alphabet Inc.", ok: true },
    ]);
    expect(text.split("\n")).toEqual([
      "✓ Added Apple Inc. (AAPL) to your Watchlist.",
      "✗ Couldn't add Microsoft Corporation (MSFT). Please try again.",
      "✓ Added Alphabet Inc. (GOOGL) to your Watchlist.",
    ]);
    expect(allFailed).toBe(false);
  });
});
