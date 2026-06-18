"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A dependency-free markdown renderer scoped to what the copilot actually
 * emits: headings, bullet/numbered lists, bold/italic/inline-code, blockquotes,
 * paragraphs, and inline `[source:tag]` citation markers styled as chips. This
 * avoids pulling a heavyweight markdown library for a constrained output space.
 */

/** Parse inline spans: **bold**, *italic*, `code`, and [citation] tags. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  // Matches **bold**, *italic*, `code`, or [source:tag] / [news].
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[a-z]+:[^\]]+\]|\[news(?::\d+)?\])/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      tokens.push(<strong key={key} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      tokens.push(<code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("[")) {
      tokens.push(
        <span key={key} className="mx-0.5 rounded bg-accent/10 px-1 font-mono text-[0.72em] text-accent" title="cited source">
          {tok.slice(1, -1)}
        </span>,
      );
    } else if (tok.startsWith("*")) {
      tokens.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return tokens;
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    out.push(
      list.ordered ? (
        <ol key={`l-${key++}`} className="my-2 ml-5 list-decimal space-y-1">
          {items.map((it, i) => <li key={i}>{renderInline(it, `oli-${key}-${i}`)}</li>)}
        </ol>
      ) : (
        <ul key={`l-${key++}`} className="my-2 ml-5 list-disc space-y-1">
          {items.map((it, i) => <li key={i}>{renderInline(it, `uli-${key}-${i}`)}</li>)}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const ltrim = raw.trimStart();
    const heading = /^(#{1,6})\s+(.*)$/.exec(ltrim);
    const bullet = /^[-*]\s+(.*)$/.exec(ltrim);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(ltrim);
    const quote = /^>\s+(.*)$/.exec(ltrim);

    if (heading) {
      flushList();
      const level = heading[1].length;
      const cls = level <= 2
        ? "mt-4 mb-1 text-base font-semibold text-foreground"
        : "mt-3 mb-1 text-sm font-semibold text-foreground";
      out.push(<p key={`h-${key++}`} className={cls}>{renderInline(heading[2], `h-${key}`)}</p>);
    } else if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (ordered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(ordered[1]);
    } else if (quote) {
      flushList();
      out.push(
        <blockquote key={`q-${key++}`} className="my-2 border-l-2 border-border pl-3 text-muted">
          {renderInline(quote[1], `q-${key}`)}
        </blockquote>,
      );
    } else if (ltrim === "") {
      flushList();
    } else {
      flushList();
      out.push(<p key={`p-${key++}`} className="my-1.5 leading-6">{renderInline(ltrim, `p-${key}`)}</p>);
    }
  }
  flushList();

  return <Fragment>{out}</Fragment>;
}
