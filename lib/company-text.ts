/**
 * Pure text helpers for the company orientation layer. Client-safe (zero
 * dependencies): shared by lib/ai-company-brief.ts (server fallback) and
 * app/research/_components/company-orientation.tsx (first-paint fallback
 * while the brief is still in flight).
 */

/** Corporate abbreviations a sentence boundary must not split after. */
const ABBREVIATION_RE = /\b(?:Corp|Inc|Ltd|Cos?|S\.A|N\.V|L\.P|U\.S|U\.K|No|St)\.$/i;

function truncateAtWord(text: string, maxLen: number): string {
  const cut = text.slice(0, maxLen);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 40 ? space : maxLen).trimEnd()}…`;
}

/**
 * The first real sentence of a business description — the deterministic
 * "what does this company do?" answer when AI is unavailable. Skips false
 * boundaries after corporate abbreviations ("Zeta Global Holdings Corp.
 * operates…" is one sentence, not two).
 */
export function firstSentence(text: string | null | undefined, maxLen = 280): string | null {
  const t = text?.trim();
  if (!t) return null;

  const boundary = /[.!?](?=\s+[A-Z0-9"“])/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(t)) != null) {
    const candidate = t.slice(0, match.index + 1);
    if (ABBREVIATION_RE.test(candidate)) continue;
    if (candidate.length < 20) continue; // too short to be the real sentence
    return candidate.length <= maxLen ? candidate : truncateAtWord(candidate, maxLen);
  }
  return t.length <= maxLen ? t : truncateAtWord(t, maxLen);
}

/** Legal suffixes that add nothing when addressing a company conversationally. */
const NAME_SUFFIXES = new Set([
  "inc", "inc.", "incorporated",
  "corp", "corp.", "corporation",
  "ltd", "ltd.", "limited",
  "plc", "co", "co.", "company",
  "sa", "s.a.", "nv", "n.v.", "ag", "se", "ab", "asa", "oyj", "spa", "s.p.a.",
]);

/**
 * A conversational company name for headings like "What does Zeta Global
 * Holdings do?" — strips trailing legal suffixes and share-class qualifiers
 * ("Class A"), never the distinctive part of the name.
 */
export function shortCompanyName(name: string | null | undefined, fallback: string): string {
  if (!name?.trim()) return fallback;
  const words = name.replace(/,/g, " ").replace(/\(the\)/i, " ").split(/\s+/).filter(Boolean);
  let strippedSuffix = false;
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase();
    const prev = words[words.length - 2]?.toLowerCase();
    if (NAME_SUFFIXES.has(last)) {
      words.pop();
      strippedSuffix = true;
      continue;
    }
    if (/^[a-c]$/.test(last) && (prev === "class" || prev === "series")) {
      words.splice(-2);
      continue;
    }
    break;
  }
  // "The Coca-Cola Company" → "Coca-Cola", not the dangling "The Coca-Cola".
  if (strippedSuffix && words.length > 1 && words[0].toLowerCase() === "the") words.shift();
  const cleaned = words.join(" ").trim();
  return cleaned.length > 1 ? cleaned : name.trim();
}
