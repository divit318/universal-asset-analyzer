/**
 * Zod → JSON Schema (Draft 7) for Devin's structured_output_schema.
 *
 * The platform's documented constraints (ai-migration/02 §1c): Draft 7, max
 * 64KB, self-contained (no external $ref). Zod v4 emits Draft 7 natively;
 * this wrapper enforces the size/self-containment constraints at the seam so
 * a schema that would be silently rejected fails loudly at build time of the
 * request instead.
 */

import { z } from "zod";

const MAX_SCHEMA_BYTES = 64 * 1024;

export class SchemaConversionError extends Error {
  code = "devin_schema" as const;
  constructor(detail: string) {
    super(`structured_output_schema constraint violated: ${detail}`);
    this.name = "SchemaConversionError";
  }
}

export function toStructuredOutputSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  const serialized = JSON.stringify(json);
  if (serialized.length > MAX_SCHEMA_BYTES) {
    throw new SchemaConversionError(`schema is ${serialized.length} bytes (max ${MAX_SCHEMA_BYTES})`);
  }
  // Draft 7 must be self-contained: any external $ref ("http…", cross-file)
  // is rejected by the platform. Local "#/…" refs are fine.
  if (/"\$ref"\s*:\s*"(?!#)/.test(serialized)) {
    throw new SchemaConversionError("schema contains a non-local $ref; it must be self-contained");
  }
  return json;
}
