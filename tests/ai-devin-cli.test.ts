/**
 * The pure parts of the Devin CLI transport: output sanitation, prompt
 * flattening, and the subprocess pool's admission policy. The first two are
 * silent-corruption surfaces — a fenced JSON body and a banner-prefixed answer
 * are perfectly valid *strings*, so neither throws; they just make every
 * downstream parse fail and render an empty state.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanDevinOutput, devinSlotsForTests, flattenMessages } from "@/lib/ai/devin-cli";

describe("cleanDevinOutput", () => {
  it("passes a plain answer straight through", () => {
    expect(cleanDevinOutput("  NVDA looks expensive.  ")).toBe("NVDA looks expensive.");
  });

  it("strips ANSI colour codes", () => {
    expect(cleanDevinOutput("\u001b[1mBUY\u001b[0m")).toBe("BUY");
  });

  it("drops the one-time onboarding banner that precedes the answer", () => {
    // Observed verbatim on a cold config: the CLI greets on stdout, ahead of
    // the model's output, so the "answer" began with "Welcome to Devin CLI!".
    const raw = [
      "\u001b[1mWelcome to Devin CLI!\u001b[0m",
      "Logged in as analyst@example.com.",
      "",
      "✓ Organization: example-org",
      "You're all set. Run \u001b[1mdevin\u001b[0m to get started.",
      "391",
    ].join("\n");
    expect(cleanDevinOutput(raw)).toBe("391");
  });

  it("unwraps a ```json fence in json mode", () => {
    const raw = '```json\n{"verdict":"HOLD","confidence":72}\n```';
    expect(cleanDevinOutput(raw, { json: true })).toBe('{"verdict":"HOLD","confidence":72}');
    expect(JSON.parse(cleanDevinOutput(raw, { json: true }))).toEqual({ verdict: "HOLD", confidence: 72 });
  });

  it("unwraps a bare fence too", () => {
    expect(cleanDevinOutput('```\n{"a":1}\n```', { json: true })).toBe('{"a":1}');
  });

  it("leaves prose fences alone when not in json mode", () => {
    // A prose answer may legitimately contain a code block; stripping it would
    // silently delete content the user asked for.
    const raw = 'Here is the query:\n\n```sql\nSELECT 1\n```';
    expect(cleanDevinOutput(raw)).toBe(raw);
  });

  it("does not mangle unfenced json", () => {
    expect(cleanDevinOutput('{"a":1}', { json: true })).toBe('{"a":1}');
  });
});

describe("flattenMessages", () => {
  it("puts the system instruction ahead of the question", () => {
    const out = flattenMessages([
      { role: "system", content: "You are an equity analyst." },
      { role: "user", content: "Assess NVDA." },
    ]);
    expect(out).toBe("You are an equity analyst.\n\nAssess NVDA.");
  });

  it("renders prior turns as a transcript and leaves the new question last", () => {
    // The final user message must not be labelled: print mode continues text,
    // so a trailing "User: ..." invites the model to write the next turn of the
    // conversation rather than answer it.
    const out = flattenMessages([
      { role: "system", content: "SYS" },
      { role: "user", content: "What is the P/E?" },
      { role: "assistant", content: "52.1" },
      { role: "user", content: "Is that cheap?" },
    ]);
    expect(out).toContain("## Conversation so far");
    expect(out).toContain("User: What is the P/E?");
    expect(out).toContain("Assistant: 52.1");
    expect(out.endsWith("Is that cheap?")).toBe(true);
  });

  it("appends the JSON-only directive in json mode, and only then", () => {
    const msgs = [{ role: "user" as const, content: "Score it." }];
    expect(flattenMessages(msgs, { json: true })).toMatch(/Respond ONLY with valid JSON/);
    expect(flattenMessages(msgs)).toBe("Score it.");
  });

  it("survives a message list with no user turn", () => {
    expect(flattenMessages([{ role: "system", content: "SYS" }])).toBe("SYS");
    expect(flattenMessages([])).toBe("");
  });

  it("leads with the read-these-images directive when image paths are attached", () => {
    // Vision path: the directive must come FIRST so the agent reads the
    // screenshots before it starts answering, and each path must be listed.
    const out = flattenMessages(
      [
        { role: "system", content: "SYS" },
        { role: "user", content: "Transcribe the holdings." },
      ],
      { imagePaths: ["/ws/images/img-a-0.png", "/ws/images/img-a-1.jpg"] },
    );
    expect(out.startsWith("## Attached images")).toBe(true);
    expect(out).toContain("1. /ws/images/img-a-0.png");
    expect(out).toContain("2. /ws/images/img-a-1.jpg");
    expect(out.indexOf("## Attached images")).toBeLessThan(out.indexOf("SYS"));
    expect(out.endsWith("Transcribe the holdings.")).toBe(true);
  });

  it("adds no image block when there are no image paths", () => {
    const msgs = [{ role: "user" as const, content: "Q" }];
    expect(flattenMessages(msgs, { imagePaths: [] })).toBe("Q");
  });
});

describe("subprocess pool admission (background isolation)", () => {
  const { acquire, snapshot, reset } = devinSlotsForTests;

  beforeEach(() => {
    reset();
    process.env.DEVIN_CLI_CONCURRENCY = "4";
    process.env.DEVIN_CLI_BACKGROUND_CONCURRENCY = "2";
  });
  afterEach(() => {
    reset();
    delete process.env.DEVIN_CLI_CONCURRENCY;
    delete process.env.DEVIN_CLI_BACKGROUND_CONCURRENCY;
  });

  it("caps background work below the full pool so interactive slots always exist", async () => {
    const bg1 = await acquire(true);
    const bg2 = await acquire(true);
    // Third background call must queue even though the pool (4) has room.
    let bg3Admitted = false;
    const bg3 = acquire(true).then((release) => {
      bg3Admitted = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(bg3Admitted).toBe(false);
    expect(snapshot()).toEqual({ active: 2, activeBackground: 2, waiting: 1 });

    // Interactive work sails straight through the reserved headroom.
    const fg = await acquire(false);
    expect(snapshot().active).toBe(3);

    bg1();
    await bg3.then((release) => release());
    bg2();
    fg();
    expect(snapshot()).toEqual({ active: 0, activeBackground: 0, waiting: 0 });
  });

  it("admits a waiting interactive call ahead of an earlier-queued background call", async () => {
    // Fill the whole pool: 2 background + 2 interactive.
    const releases = [await acquire(true), await acquire(true), await acquire(false), await acquire(false)];

    const order: string[] = [];
    const bgWaiter = acquire(true).then((r) => {
      order.push("background");
      return r;
    });
    const fgWaiter = acquire(false).then((r) => {
      order.push("interactive");
      return r;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]); // both queued — pool is full

    // One interactive slot frees: the INTERACTIVE waiter must win despite the
    // background one having queued first.
    releases[2]();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["interactive"]);

    // A background slot frees: now the background waiter is admitted.
    releases[0]();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["interactive", "background"]);

    releases[1]();
    releases[3]();
    await bgWaiter.then((r) => r());
    await fgWaiter.then((r) => r());
    expect(snapshot()).toEqual({ active: 0, activeBackground: 0, waiting: 0 });
  });
});
