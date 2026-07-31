/**
 * Resolves which Python interpreter to spawn for the quant engine, and provides
 * the one bounded way to run a read-only engine script from a request handler.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

let cached: string | null = null;

export function enginePython(): string {
  if (cached) return cached;

  // Built via join(), not path.join(process.cwd(), literal, ...) — that exact
  // call shape makes Turbopack's output tracer treat .venv/bin as a directory
  // asset reference, and it panics on .venv's Homebrew python symlink (which
  // resolves outside the project root).
  const venvPython = [process.cwd(), ".venv", "bin", "python"].join(path.sep);
  cached = fs.existsSync(venvPython) ? venvPython : "python3";
  return cached;
}

/** Thrown when a spawned engine script exceeded its budget and was killed. */
export class EngineTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Engine query exceeded ${timeoutMs}ms and was cancelled`);
    this.name = "EngineTimeoutError";
  }
}

/**
 * Run an engine script and resolve its stdout, under a hard wall-clock budget.
 *
 * Every read path used to hand-roll `spawn` with no timeout, which is how the
 * page came to "occasionally appear to hang": these scripts open
 * `data/engine.duckdb`, and a cold read of a multi-GB DuckDB file can take tens
 * of seconds — or minutes — even when the queries themselves are instant. With
 * no timeout that turns into an unbounded pending request and a spinner that
 * never resolves. Here the child is killed at the deadline and the caller gets a
 * typed failure it can degrade on, so a slow section fails visibly and alone.
 */
export function runEnginePython(
  args: string[],
  // `cwd` is optional rather than defaulted to `process.cwd()`: omitting it lets
  // `spawn` inherit the parent's working directory, which is the intended
  // behaviour, and keeps one fewer `process.cwd()` call in a module whose
  // interaction with Turbopack's file tracer is already delicate (see the
  // `join()`-not-`path.join()` note in `enginePython` above).
  { timeoutMs = 15_000, cwd }: { timeoutMs?: number; cwd?: string } = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const py = spawn(enginePython(), args, cwd ? { cwd } : undefined);
    let out = "";
    let err = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      // SIGKILL, not SIGTERM: a child blocked in a DuckDB file read does not
      // reliably service a catchable signal, and a "cancelled" request that
      // leaves the process running would leak one per retry.
      try { py.kill("SIGKILL"); } catch { /* already gone */ }
      reject(new EngineTimeoutError(timeoutMs));
    }, timeoutMs);

    py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    py.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    py.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    py.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(err.trim() || `Engine script exited ${code}`));
      else resolve(out);
    });
  });
}
