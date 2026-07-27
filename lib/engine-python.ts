/**
 * Resolves which Python interpreter to spawn for the quant engine.
 * Prefers the project-local virtualenv (created via `python3 -m venv .venv`
 * per requirements.txt) over the bare system `python3`, since the system
 * interpreter has none of the engine's dependencies installed.
 */

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
