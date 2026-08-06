/**
 * The pure parts of the Devin CLI transport: output sanitation and prompt
 * flattening. Both are silent-corruption surfaces — a fenced JSON body and a
 * banner-prefixed answer are perfectly valid *strings*, so neither throws;
 * they just make every downstream parse fail and render an empty state.
 */
import { describe, expect, it } from "vitest";
import { cleanDevinOutput, flattenMessages } from "@/lib/ai/devin-cli";

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
});
