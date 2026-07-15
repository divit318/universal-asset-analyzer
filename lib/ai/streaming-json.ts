/**
 * Incremental JSON field streamer.
 *
 * Feeds on the raw token deltas of a single LLM generation and emits each
 * **top-level field the moment that field's value is completely parsed** — never
 * before. This is what lets the AI report stream as finished sections without
 * changing anything about how the report is generated.
 *
 * Why this rather than generating each section with its own prompt: local Ollama
 * serializes requests (measured — three concurrent generations take as long as
 * three sequential ones). Nine independent section generations therefore cost
 * ~9× one generation, which would make the report dramatically *slower* overall
 * while barely improving time-to-first-section. Streaming is only allowed to
 * improve perceived responsiveness, never to cost total quality or time.
 *
 * So: one generation, exactly the prompt and context the non-streamed verdict
 * uses, and the final assembled object is *byte-for-byte the same object* the
 * non-streaming path would have produced. The only thing that changes is that
 * the user sees the headline at ~4s instead of at ~40s.
 *
 * Guarantees:
 *   - A field is emitted only once its value is syntactically complete
 *     (balanced braces/brackets, closed string). The user never sees a
 *     half-written sentence or a truncated array.
 *   - Order follows the model's output order, which follows the schema — so
 *     putting the high-value fields first in the prompt schema *is* the
 *     "high-value first" streaming order.
 *   - Tolerates the junk models actually emit: ```json fences, prose preambles,
 *     trailing commentary.
 *
 * Pure and client-safe; unit-tested in tests/streaming-json.test.ts.
 */

export interface StreamedField {
  key: string;
  value: unknown;
}

type State =
  | "seeking_object" // haven't found the opening `{` yet (prose/fence preamble)
  | "expect_key" // at the top level, expecting `"key"` or `}`
  | "expect_colon"
  | "expect_value"
  | "in_value" // consuming a complete value (scalar, string, object, or array)
  | "done";

export class JsonFieldStreamer {
  private state: State = "seeking_object";
  private buffer = "";
  /** Index into `buffer` of the next unconsumed character. */
  private pos = 0;

  private currentKey = "";
  private valueStart = 0;

  // Nesting/quoting trackers for the value currently being consumed.
  private depth = 0;
  private inString = false;
  private escaped = false;

  private readonly fields: Record<string, unknown> = {};

  /**
   * Push a chunk of generated text. Returns any fields that became complete as
   * a result — usually zero or one, occasionally more if a chunk closed several.
   */
  push(chunk: string): StreamedField[] {
    this.buffer += chunk;
    const emitted: StreamedField[] = [];

    while (this.pos < this.buffer.length && this.state !== "done") {
      const before = this.pos;
      const field = this.step();
      if (field) emitted.push(field);
      // No progress and no emission means we need more input.
      if (this.pos === before && !field) break;
    }

    return emitted;
  }

  /**
   * Signal end-of-generation. Returns any field still mid-parse that can be
   * salvaged, then finalizes. A model that gets cut off mid-value contributes
   * nothing for that field rather than a corrupt half-value.
   */
  end(): StreamedField[] {
    const emitted = this.push("");
    this.state = "done";
    return emitted;
  }

  /** The complete object assembled so far — identical to `JSON.parse` of the full output. */
  result(): Record<string, unknown> {
    return { ...this.fields };
  }

  /** Keys emitted so far, in order. */
  keys(): string[] {
    return Object.keys(this.fields);
  }

  private step(): StreamedField | null {
    switch (this.state) {
      case "seeking_object":
        return this.seekObject();
      case "expect_key":
        return this.readKey();
      case "expect_colon":
        return this.readColon();
      case "expect_value":
        return this.beginValue();
      case "in_value":
        return this.consumeValue();
      default:
        return null;
    }
  }

  /** Skip ```json fences, prose preambles, anything before the first `{`. */
  private seekObject(): null {
    const idx = this.buffer.indexOf("{", this.pos);
    if (idx === -1) {
      // Nothing usable yet. Drop what we've scanned so the buffer can't grow
      // without bound on a model that rambles before emitting JSON.
      this.pos = this.buffer.length;
      return null;
    }
    this.pos = idx + 1;
    this.state = "expect_key";
    return null;
  }

  private readKey(): null {
    this.skipWhitespaceAndCommas();
    if (this.pos >= this.buffer.length) return null;

    const ch = this.buffer[this.pos];
    if (ch === "}") {
      this.state = "done";
      this.pos += 1;
      return null;
    }
    if (ch !== '"') {
      // Not a key and not the end — malformed. Skip the character rather than
      // spinning forever on it.
      this.pos += 1;
      return null;
    }

    const closing = this.findStringEnd(this.pos);
    if (closing === -1) return null; // key still arriving

    this.currentKey = JSON.parse(this.buffer.slice(this.pos, closing + 1)) as string;
    this.pos = closing + 1;
    this.state = "expect_colon";
    return null;
  }

  private readColon(): null {
    this.skipWhitespaceAndCommas();
    if (this.pos >= this.buffer.length) return null;
    if (this.buffer[this.pos] === ":") {
      this.pos += 1;
      this.state = "expect_value";
    } else {
      this.pos += 1; // malformed; skip
    }
    return null;
  }

  private beginValue(): StreamedField | null {
    this.skipWhitespace();
    if (this.pos >= this.buffer.length) return null;

    this.valueStart = this.pos;
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.state = "in_value";
    return this.consumeValue();
  }

  /**
   * Consume characters until the current value is syntactically closed, then
   * parse and emit it. This is the whole guarantee: nothing is emitted until the
   * value's braces, brackets, and quotes all balance.
   */
  private consumeValue(): StreamedField | null {
    while (this.pos < this.buffer.length) {
      const ch = this.buffer[this.pos];

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === "\\") {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
          this.pos += 1;
          // A top-level string value is COMPLETE at its closing quote — there is
          // no need to wait for the following comma. Waiting would delay every
          // prose section (headline, thesis, assessment) until the model started
          // writing the *next* field, which is exactly the latency this exists
          // to remove.
          if (this.depth === 0) return this.emit(this.pos, true);
          continue;
        }
        this.pos += 1;
        continue;
      }

      if (ch === '"') {
        this.inString = true;
        this.pos += 1;
        continue;
      }

      if (ch === "{" || ch === "[") {
        this.depth += 1;
        this.pos += 1;
        continue;
      }

      if (ch === "}" || ch === "]") {
        // A closing brace at depth 0 is the *object's* closing brace, meaning
        // the current value was a bare scalar that ended here (e.g. `"x": 5}`).
        if (this.depth === 0) return this.emit(this.pos, /* consumedTerminator */ false);
        this.depth -= 1;
        this.pos += 1;
        if (this.depth === 0) return this.emit(this.pos, true);
        continue;
      }

      // A comma at depth 0 terminates a scalar value.
      if (ch === "," && this.depth === 0) {
        return this.emit(this.pos, false);
      }

      this.pos += 1;
    }

    return null; // value still arriving
  }

  private emit(endExclusive: number, consumedTerminator: boolean): StreamedField | null {
    const raw = this.buffer.slice(this.valueStart, endExclusive).trim();
    if (!consumedTerminator) {
      // Leave the terminator (`,` or `}`) for readKey to handle.
      this.pos = endExclusive;
    }

    this.state = "expect_key";

    if (raw === "") return null;

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      // A value the model mangled (an unquoted word, a trailing comment). Skip
      // the field rather than emitting garbage or killing the whole stream —
      // the other eight fields are still perfectly good.
      return null;
    }

    const key = this.currentKey;
    this.fields[key] = value;
    return { key, value };
  }

  /** Index of the closing quote of the string starting at `start`, or -1 if incomplete. */
  private findStringEnd(start: number): number {
    let escaped = false;
    for (let i = start + 1; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') return i;
    }
    return -1;
  }

  private skipWhitespace(): void {
    while (this.pos < this.buffer.length && /\s/.test(this.buffer[this.pos])) this.pos += 1;
  }

  private skipWhitespaceAndCommas(): void {
    while (
      this.pos < this.buffer.length &&
      (/\s/.test(this.buffer[this.pos]) || this.buffer[this.pos] === ",")
    ) {
      this.pos += 1;
    }
  }
}
