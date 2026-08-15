"use client";

/**
 * IV · THE WEEK — now → today → this week → horizon.
 *
 * A temporal shelf over the digest's real upcoming events (earnings and
 * dividends for symbols you hold or watch, plus the macro calendar), with
 * the session state anchoring NOW. Titles stay terse; detail arrives on
 * hover/focus (the grid-rows reveal). Events link to their surface.
 */

import Link from "next/link";
import { useMemo } from "react";
import { withFromToday } from "@/lib/home/attention";
import type { UpcomingEventLite } from "@/lib/mission-control";
import { countdown } from "../_viz/format";
import { useHomeSlice } from "../home-provider";
import { Eyebrow } from "./primitives";

type Tone = "hot" | "warm" | "action" | "live" | "quiet";

const TONE_DIAMOND: Record<Tone, string> = {
  hot: "bg-negative",
  warm: "bg-warning",
  action: "bg-brand",
  live: "bg-positive shadow-[0_0_8px_color-mix(in_srgb,var(--positive)_45%,transparent)]",
  quiet: "bg-faint",
};

interface ZoneItem {
  id: string;
  title: string;
  detail: string;
  tone: Tone;
  href: string | null;
}

interface Zone {
  name: string;
  note: string;
  items: ZoneItem[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T12:00:00Z`))
    .toUpperCase();
}

function eventTone(e: UpcomingEventLite, held: Set<string>): Tone {
  const t = e.type.toLowerCase();
  if (t.includes("earn")) return e.symbol && held.has(e.symbol) ? "hot" : "warm";
  if (t.includes("div")) return "quiet";
  return e.symbol ? "quiet" : "warm";
}

function toItem(e: UpcomingEventLite, held: Set<string>): ZoneItem {
  const dateIso = `${e.date}T12:00:00Z`;
  return {
    id: e.id,
    title: e.symbol ? `${e.symbol} — ${e.type}` : e.name,
    detail: `${e.symbol ? `${e.name} · ` : ""}${shortDate(e.date)} · ${countdown(dateIso)}${
      e.symbol && held.has(e.symbol) ? " · held" : ""
    }`,
    tone: eventTone(e, held),
    href: e.symbol ? withFromToday(`/research?symbol=${encodeURIComponent(e.symbol)}`) : withFromToday("/calendar"),
  };
}

export function Week() {
  const events = useHomeSlice("upcomingEvents");
  const pulse = useHomeSlice("portfolioPulse");
  const market = useHomeSlice("marketIntelligence");
  const generatedAt = useHomeSlice("attention").data?.reviewedAt ?? null;

  const zones: Zone[] = useMemo(() => {
    const now = new Date();
    const todayKey = dayKey(now);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndKey = dayKey(weekEnd);

    const all = (events.data?.events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const held = new Set((pulse.data?.topPositions ?? []).map((p) => p.symbol));

    const todayEvents = all.filter((e) => e.date === todayKey);
    const weekEvents = all.filter((e) => e.date > todayKey && e.date <= weekEndKey);
    const horizonEvents = all.filter((e) => e.date > weekEndKey);

    const nowItems: ZoneItem[] = [];
    if (pulse.data?.sessionNote) {
      nowItems.push({
        id: "session",
        title: "Equity session",
        detail: pulse.data.sessionNote,
        tone: "quiet",
        href: null,
      });
    }
    const btc = market.data?.groups
      .find((g) => g.id === "crypto")
      ?.tickers.find((t) => t.changePct != null);
    if (btc) {
      nowItems.push({
        id: "crypto-live",
        title: "Crypto is live",
        detail: `${btc.label} ${btc.changePct! >= 0 ? "+" : "−"}${Math.abs(btc.changePct!).toFixed(1)}% — a tape that never closes.`,
        tone: "live",
        href: withFromToday("/wire"),
      });
    }

    const todayItems = todayEvents.map((e) => toItem(e, held));
    if (generatedAt) {
      todayItems.push({
        id: "digest",
        title: `Digest assembled ${new Date(generatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}`,
        detail: "From your book, your policy, the queue, and the calendar.",
        tone: "action",
        href: null,
      });
    }

    const horizonEnd = all.length ? shortDate(all[all.length - 1].date) : null;

    return [
      {
        name: "NOW",
        note: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }),
        items: nowItems,
      },
      {
        name: "TODAY",
        note: now.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase(),
        items: todayItems,
      },
      {
        name: "THIS WEEK",
        note: `TO ${shortDate(weekEndKey)}`,
        items: weekEvents.map((e) => toItem(e, held)),
      },
      {
        name: "HORIZON",
        note: horizonEnd ? `TO ${horizonEnd}` : "NEXT 14 DAYS",
        items: horizonEvents.map((e) => toItem(e, held)),
      },
    ];
  }, [events.data, pulse.data, market.data, generatedAt]);

  const nextHeld = useMemo(() => {
    const held = new Set((pulse.data?.topPositions ?? []).map((p) => p.symbol));
    const todayKey = dayKey(new Date());
    return (events.data?.events ?? [])
      .filter((e) => e.symbol && held.has(e.symbol) && e.date >= todayKey)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  }, [events.data, pulse.data]);

  return (
    <section id="tdy-week" aria-labelledby="tdy-week-h" className="border-b border-hairline py-14 max-md:py-10">
      <div className="tdy-shell">
        <Eyebrow
          id="tdy-week-h"
          note={nextHeld ? `NEXT HELD: ${nextHeld.symbol} ${shortDate(nextHeld.date)}` : undefined}
        >
          The week — now to horizon
        </Eyebrow>

        <div className="mt-8 grid grid-cols-[16fr_18fr_42fr_24fr] max-lg:grid-cols-2 max-lg:gap-y-8 max-md:grid-cols-1">
          {zones.map((zone, zi) => (
            <div
              key={zone.name}
              className={`pr-7 max-md:pr-0 ${zi > 0 ? "border-l border-hairline pl-7 max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(3)]:pl-0 max-md:mt-2 max-md:border-l-0 max-md:pl-0" : ""}`}
            >
              <div className="mb-3.5 flex items-baseline justify-between gap-2.5">
                <span
                  className={`font-mono text-[10px] tracking-[0.22em] ${zone.name === "NOW" ? "text-brand-strong" : "text-brand"}`}
                >
                  {zone.name}
                </span>
                <span className="font-mono text-[10px] text-faint tabular-nums">{zone.note}</span>
              </div>
              <div className="relative mb-5 h-px bg-foreground/10" aria-hidden="true">
                <span
                  className={`absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rotate-45 bg-brand ${
                    zone.name === "NOW" ? "shadow-[0_0_10px_color-mix(in_srgb,var(--brand)_35%,transparent)]" : ""
                  }`}
                />
              </div>
              <ul className="flex flex-col gap-1">
                {zone.items.length === 0 ? (
                  <li className="px-2.5 py-2 text-xs text-faint">Nothing scheduled.</li>
                ) : (
                  zone.items.map((item) => {
                    const inner = (
                      <>
                        <p className="flex items-center gap-2.5 text-[13.5px] font-medium">
                          <span className={`h-[5px] w-[5px] flex-none rotate-45 ${TONE_DIAMOND[item.tone]}`} aria-hidden="true" />
                          {item.title}
                        </p>
                        <div className="tdy-zi-detail">
                          <div>
                            <p className="pl-[15px] pt-1 text-xs leading-relaxed text-faint">{item.detail}</p>
                          </div>
                        </div>
                      </>
                    );
                    const cls =
                      "tdy-zone-item -mx-2.5 block rounded-md px-2.5 py-2 transition-colors duration-(--duration-base) hover:bg-surface/70";
                    return (
                      <li key={item.id}>
                        {item.href ? (
                          <Link href={item.href} className={cls}>
                            {inner}
                          </Link>
                        ) : (
                          <div className={cls} tabIndex={0}>
                            {inner}
                          </div>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
