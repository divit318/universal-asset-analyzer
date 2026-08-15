/* UAA Today — Level 10 prototype. Interaction engine.
   Motion follows the app's machined-instrument system: monotonic curves,
   no bounce, direction colors are sacred, reduced-motion renders final state. */
"use strict";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const fmtUSD = (v) => "$" + Math.round(v).toLocaleString("en-US");
const fmtUSDSign = (v) => (v < 0 ? "−$" : "+$") + Math.abs(Math.round(v)).toLocaleString("en-US");
const fmtPct = (v, dp = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dp) + "%";
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ── Toast ──────────────────────────────────────────────────────────── */

const toastEl = $("#toast");
let toastTimer = null;
function toast(html) {
  toastEl.innerHTML = html;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add("is-on"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2800);
}

function stub(label) {
  toast("PROTOTYPE · <b>" + label + "</b> is stubbed here — it opens the real surface in UAA");
}

/* ── Count-up numbers (first arrival draws itself) ─────────────────── */

function countUp(el) {
  const target = parseFloat(el.dataset.count);
  const fmt = el.dataset.fmt;
  const render = (v) =>
    (el.textContent = fmt === "usd" ? fmtUSD(v) : fmt === "usd-sign" ? fmtUSDSign(v) : String(Math.round(v)));
  if (reduceMotion) return render(target);
  const t0 = performance.now();
  const dur = 900;
  (function frame(now) {
    const p = Math.min(1, (now - t0) / dur);
    render(target * easeOutCubic(p));
    if (p < 1) requestAnimationFrame(frame);
  })(t0);
}

/* ── The Pulse Filament ────────────────────────────────────────────── */

function sessionDates(n) {
  const out = [];
  const d = new Date(2026, 7, 14); // Fri Aug 14, 2026 — last session
  while (out.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

const filament = {
  host: $("#filament"),
  wrap: $(".filament"),
  scrubEl: $("#scrub"),
  pts: null,
  drawn: false,

  build() {
    const { portfolio, spx } = UAA.curve;
    const n = portfolio.length;
    const rect = this.host.getBoundingClientRect();
    const W = Math.max(320, rect.width);
    const H = rect.height;
    const padT = 18, padB = 26;
    const all = portfolio.concat(spx);
    const min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    const x = (i) => (i / (n - 1)) * W;
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const line = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");

    this.pts = { n, x, y, W, H };
    const dates = sessionDates(n);
    const dateLabel = (i) =>
      dates[i].toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

    const grid = [0.25, 0.5, 0.75]
      .map((f) => `<line class="fil-grid" x1="${(f * W).toFixed(1)}" y1="${padT}" x2="${(f * W).toFixed(1)}" y2="${H - padB}"/>`)
      .join("");

    const lastX = x(n - 1), lastY = y(portfolio[n - 1]);

    this.host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <defs>
          <linearGradient id="fil-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="rgba(200,169,110,0.10)"/>
            <stop offset="1" stop-color="rgba(200,169,110,0)"/>
          </linearGradient>
        </defs>
        ${grid}
        <line class="fil-grid" x1="0" y1="${y(portfolio[0]).toFixed(1)}" x2="${W}" y2="${y(portfolio[0]).toFixed(1)}" stroke-dasharray="2 5"/>
        <path class="fil-area" d="${line(portfolio)} L ${W} ${H - padB} L 0 ${H - padB} Z"/>
        <path class="fil-spx" d="${line(spx)}"/>
        <path class="fil-you" d="${line(portfolio)}"/>
        <line class="fil-cross" x1="0" y1="${padT}" x2="0" y2="${H - padB}"/>
        <circle class="fil-node-spx" r="2.5" cx="0" cy="0"/>
        <circle class="fil-node" r="3" cx="0" cy="0"/>
        <circle class="fil-halo" r="8" cx="${lastX}" cy="${lastY}"/>
        <circle class="fil-terminus" r="3" cx="${lastX}" cy="${lastY}"/>
        <text class="fil-tick" x="2" y="${H - 8}">${dateLabel(0)}</text>
        <text class="fil-tick" x="${W / 2}" y="${H - 8}" text-anchor="middle">${dateLabel(Math.floor(n / 2))}</text>
        <text class="fil-tick" x="${W - 2}" y="${H - 8}" text-anchor="end">${UAA.curve.endLabel}</text>
      </svg>`;

    const you = $(".fil-you", this.host);
    const spxPath = $(".fil-spx", this.host);
    const area = $(".fil-area", this.host);

    if (!this.drawn && !reduceMotion) {
      for (const [p, dur, delay] of [[you, 1500, 120], [spxPath, 1500, 240]]) {
        const L = p.getTotalLength();
        p.style.strokeDasharray = L;
        p.style.strokeDashoffset = L;
        p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], {
          duration: dur, delay, easing: EASE_OUT, fill: "forwards",
        }).onfinish = () => { p.style.strokeDasharray = "none"; p.style.strokeDashoffset = 0; };
      }
      setTimeout(() => area.classList.add("is-in"), 900);
    } else {
      area.classList.add("is-in");
    }
    this.drawn = true;
    this.dates = dates;
  },

  scrub(clientX) {
    if (!this.pts) return;
    const rect = this.host.getBoundingClientRect();
    const { n, x, y } = this.pts;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (n - 1));
    const px = x(i);
    const { portfolio, spx } = UAA.curve;

    $(".fil-cross", this.host).setAttribute("x1", px);
    $(".fil-cross", this.host).setAttribute("x2", px);
    const node = $(".fil-node", this.host);
    node.setAttribute("cx", px); node.setAttribute("cy", y(portfolio[i]));
    const nodeS = $(".fil-node-spx", this.host);
    nodeS.setAttribute("cx", px); nodeS.setAttribute("cy", y(spx[i]));

    const youCum = ((portfolio[i] / portfolio[0]) - 1) * 100;
    const spxCum = ((spx[i] / spx[0]) - 1) * 100;
    const d = this.dates[i].toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
    this.scrubEl.innerHTML =
      `${d} · <b>${fmtUSD(portfolio[i])}</b> · <span class="pos">YOU ${fmtPct(youCum, 1)}</span> · SPX ${fmtPct(spxCum, 1)}`;
    this.scrubEl.hidden = false;
    const sw = this.scrubEl.offsetWidth;
    const left = Math.min(rect.width - sw / 2 - 8, Math.max(sw / 2 + 8, px));
    this.scrubEl.style.left = left + "px";
    this.wrap.classList.add("is-scrubbing");
  },

  end() {
    this.wrap.classList.remove("is-scrubbing");
    this.scrubEl.hidden = true;
  },
};

filament.build();
new ResizeObserver(() => filament.build()).observe(filament.host);
filament.host.addEventListener("pointermove", (e) => filament.scrub(e.clientX));
filament.host.addEventListener("pointerleave", () => filament.end());

/* ── Masthead ──────────────────────────────────────────────────────── */

$$("[data-count]").forEach(countUp);
requestAnimationFrame(() => { $("#risk-marker").style.left = UAA.book.risk.position * 100 + "%"; });

$("#verdict-body").textContent = UAA.verdict.body;
$("#verdict-source").textContent = UAA.verdict.source.toUpperCase();

/* ── Expansion primitive (height-animated, hidden-managed) ─────────── */

function expand(panel, open) {
  if (reduceMotion) {
    panel.hidden = !open;
    panel.style.height = open ? "auto" : "0px";
    return;
  }
  if (open) {
    panel.hidden = false;
    const h = panel.scrollHeight;
    panel.style.height = "0px";
    requestAnimationFrame(() => { panel.style.height = h + "px"; });
    panel.addEventListener("transitionend", function onEnd(e) {
      if (e.propertyName !== "height") return;
      panel.style.height = "auto";
      panel.removeEventListener("transitionend", onEnd);
    });
  } else {
    panel.style.height = panel.scrollHeight + "px";
    requestAnimationFrame(() => requestAnimationFrame(() => { panel.style.height = "0px"; }));
    panel.addEventListener("transitionend", function onEnd(e) {
      if (e.propertyName !== "height") return;
      panel.hidden = true;
      panel.removeEventListener("transitionend", onEnd);
    });
  }
}

/* ── Signals ───────────────────────────────────────────────────────── */

function impactBarHTML(b) {
  const from = (b.from / b.max) * 100, to = (b.to / b.max) * 100;
  const vals = b.static
    ? `<span class="ib-vals mono">${b.invert ? "−" : ""}${b.to}${b.unit}</span>`
    : `<span class="ib-vals mono">${b.from} <i>→</i> ${b.to}${b.unit}</span>`;
  return `
    <div class="impact-bar">
      <div class="ib-head"><span class="ib-label">${b.label}</span>${vals}</div>
      <div class="ib-track" style="--from:${b.static ? 0 : from}%; --to:${to}%">
        <span class="ib-from"></span><span class="ib-to"></span><i class="ib-marker"></i>
      </div>
    </div>`;
}

function signalHTML(s, idx) {
  const pid = "sig-p-" + s.rank, bid = "sig-b-" + s.rank;
  return `
  <li class="signal" data-kind="${s.kind}" style="--reveal-delay:${idx * 90}ms" data-reveal>
    <button class="signal-row" id="${bid}" aria-expanded="false" aria-controls="${pid}">
      <span class="signal-rank mono">${s.rank}</span>
      <span class="signal-main">
        <span class="signal-meta">
          <span class="chip chip-${s.kind}">${KIND_LABEL[s.kind]}</span>
          <span class="signal-score mono">SCORE <b>${s.score}</b> / 100</span>
        </span>
        <span class="signal-headline">${s.headline}</span>
        <span class="signal-rationale">${s.rationale}</span>
      </span>
      <span class="signal-affordance" aria-hidden="true">
        <span class="why-hint mono">WHY</span>
        <span class="caret">＋</span>
      </span>
    </button>
    <div class="signal-panel" id="${pid}" role="region" aria-labelledby="${bid}" hidden>
      <div class="panel-inner">
        <div class="panel-cols">
          <div class="panel-col why">
            <p class="panel-label mono">WHY IT MATTERS</p>
            <ul class="evidence">
              ${s.why.map((w) => `
                <li>
                  <span class="ev-label">${w.label}</span>
                  <span class="ev-value mono">${w.value}</span>
                  <span class="ev-note">${w.note}</span>
                </li>`).join("")}
            </ul>
          </div>
          <div class="panel-col rec">
            <p class="panel-label mono">RECOMMENDED</p>
            <p class="rec-action">${s.recommended.action}</p>
            <p class="rec-alt">${s.recommended.alt}</p>
            <a class="rec-cta" href="#" data-stub>${s.recommended.cta} <span aria-hidden="true">→</span></a>
          </div>
          <div class="panel-col imp">
            <p class="panel-label mono">PROJECTED IMPACT</p>
            ${s.impact.bars.map(impactBarHTML).join("")}
            <ul class="impact-lines">${s.impact.lines.map((l) => `<li>${l}</li>`).join("")}</ul>
          </div>
        </div>
        <div class="panel-foot">
          <div class="audit" aria-label="Score audit">
            ${["impact", "urgency", "confidence"].map((k) => `
              <span class="audit-item">
                <span class="audit-label mono">${k.toUpperCase()}</span>
                <span class="audit-track"><i style="--v:${s.audit[k]}"></i></span>
                <span class="audit-val mono">${s.audit[k].toFixed(2).slice(1)}</span>
              </span>`).join("")}
          </div>
          <p class="panel-source mono">${s.source.toUpperCase()}</p>
          <div class="panel-actions">
            <button class="ghost-btn" data-dismiss-signal>Dismiss</button>
            <button class="ghost-btn" data-snooze>Snooze to Monday</button>
          </div>
        </div>
      </div>
    </div>
  </li>`;
}

$("#signal-list").innerHTML = UAA.signals.map(signalHTML).join("");

$$(".signal").forEach((li) => {
  const btn = $(".signal-row", li);
  const panel = $(".signal-panel", li);
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    // One signal in focus at a time — the page is a prioritization instrument.
    $$(".signal.is-open").forEach((other) => {
      if (other !== li) {
        other.classList.remove("is-open");
        $(".signal-row", other).setAttribute("aria-expanded", "false");
        expand($(".signal-panel", other), false);
      }
    });
    btn.setAttribute("aria-expanded", String(open));
    li.classList.toggle("is-open", open);
    expand(panel, open);
  });

  $("[data-dismiss-signal]", li).addEventListener("click", () => {
    li.classList.add("is-dismissed");
    setTimeout(() => {
      li.style.overflow = "hidden";
      li.style.height = li.offsetHeight + "px";
      requestAnimationFrame(() => {
        li.style.transition = "height 280ms cubic-bezier(0.32,0.72,0,1)";
        li.style.height = "0px";
      });
      setTimeout(() => li.remove(), 300);
    }, reduceMotion ? 0 : 260);
    toast("Dismissed. <b>It returns if the story worsens</b> — severity bands resurface past dismissals.");
  });
  $("[data-snooze]", li).addEventListener("click", () => stub("Snooze"));
});

/* ── Ledger ────────────────────────────────────────────────────────── */

$("#ledger-list").innerHTML = UAA.ledger.map((l) => `
  <li class="ledger-item">
    <span class="chip chip-${l.kind}">${KIND_LABEL[l.kind]}</span>
    <span class="li-sym mono">${l.symbol}</span>
    <span class="li-text">${l.text}</span>
    <span class="li-when mono dim">${l.when.toUpperCase()}</span>
    <button class="li-dismiss mono" aria-label="Dismiss: ${l.text}">✕</button>
  </li>`).join("");

const ledgerToggle = $("#ledger-toggle");
ledgerToggle.addEventListener("click", () => {
  const open = ledgerToggle.getAttribute("aria-expanded") !== "true";
  ledgerToggle.setAttribute("aria-expanded", String(open));
  expand($("#ledger-body"), open);
});

$$(".li-dismiss").forEach((btn) =>
  btn.addEventListener("click", () => {
    const item = btn.closest(".ledger-item");
    item.classList.add("is-dismissed");
    setTimeout(() => item.remove(), reduceMotion ? 0 : 300);
  })
);

/* ── The Week ──────────────────────────────────────────────────────── */

$("#week-rail").innerHTML = UAA.week.map((z, zi) => `
  <div class="zone" data-zone="${z.zone}" data-reveal style="--reveal-delay:${zi * 90}ms">
    <div class="zone-head">
      <span class="zone-name mono">${z.zone}</span>
      <span class="zone-note mono dim">${z.note.toUpperCase()}</span>
    </div>
    <div class="zone-track" aria-hidden="true"><span class="zone-node"></span></div>
    <ul class="zone-items">
      ${z.items.map((it) => `
        <li class="zone-item" data-tone="${it.tone}" tabindex="0">
          <p class="zi-title"><span class="zi-diamond" aria-hidden="true"></span>${it.t}</p>
          <div class="zi-detail"><p>${it.d}</p></div>
        </li>`).join("")}
    </ul>
  </div>`).join("");

/* ── The Book ──────────────────────────────────────────────────────── */

$("#align-list").innerHTML = UAA.alignment.themes.map((t, i) => `
  <li class="align-row ${t.breach ? "is-breach" : ""} ${t.watch ? "is-watch" : ""}">
    <span class="al-name">${t.name}</span>
    <span class="al-track"><i class="al-fill" style="--w:${t.score / 100}; --d:${i * 70}ms"></i><b class="al-floor" aria-hidden="true"></b></span>
    <span class="al-flag mono">${t.breach ? "BREACH" : t.watch ? "WATCH" : ""}</span>
    <span class="al-score mono">${t.score}</span>
  </li>`).join("");
$("#align-note").innerHTML = UAA.alignment.note.replace("signals 01 · 02", `<a href="#signals">signals 01 · 02</a>`);

const maxAttr = Math.max.apply(null, UAA.attribution.map((a) => Math.abs(a.value)));
$("#attr-list").innerHTML = UAA.attribution.map((a, i) => `
  <li class="attr-row ${a.value < 0 ? "neg" : "pos"}">
    <span class="at-sym mono">${a.symbol}</span>
    <span class="at-track"><i class="at-fill" style="--w:${Math.abs(a.value) / maxAttr}; --d:${i * 60}ms"></i></span>
    <span class="at-val mono">${fmtUSDSign(a.value)}</span>
  </li>`).join("");

const SLEEVE_COLORS = ["#c8a96e", "#8f7b52", "#3a4150", "#e2c489", "#6b7688"];
$("#sleeve-bar").innerHTML = UAA.composition.sleeves.map((s, i) =>
  `<span class="sleeve-seg" style="flex:${s.pct}; background:${SLEEVE_COLORS[i]}"></span>`).join("");
$("#sleeve-legend").innerHTML = UAA.composition.sleeves.map((s, i) =>
  `<li><i class="swatch" style="background:${SLEEVE_COLORS[i]}" aria-hidden="true"></i>${s.name} ${s.pct}%</li>`).join("");

const maxWt = Math.max.apply(null, UAA.composition.top.map((p) => p.pct));
$("#pos-table tbody").innerHTML =
  UAA.composition.top.map((p, i) => `
    <tr>
      <td>${p.symbol}</td>
      <td>${p.pct.toFixed(1)}%</td>
      <td class="pt-bar"><span style="width:${(p.pct / maxWt) * 100}%; --d:${i * 60}ms"></span></td>
      <td class="${p.day < 0 ? "neg" : "pos"}">${fmtPct(p.day)}</td>
    </tr>`).join("") +
  `<tr><td colspan="4" class="pos-rest">${UAA.composition.rest}</td></tr>`;

const RING_C = (2 * Math.PI * 15).toFixed(2);
$("#radar-list").innerHTML = UAA.radar.map((r, i) => `
  <li class="radar-row">
    <svg class="fit-ring" viewBox="0 0 34 34" aria-hidden="true" style="--c:${RING_C}; --o:${(RING_C * (1 - r.fit / 100)).toFixed(2)}; --d:${i * 90}ms">
      <circle class="ring-bg" cx="17" cy="17" r="15"/>
      <circle class="ring-fg" cx="17" cy="17" r="15"/>
    </svg>
    <div class="radar-main">
      <p class="radar-top"><span class="radar-sym mono">${r.symbol}</span><span class="mono dim">FIT ${r.fit}</span></p>
      <p class="radar-line">${r.line}</p>
      <a class="rec-cta radar-cta" href="#" data-stub>Open in Research <span aria-hidden="true">→</span></a>
    </div>
  </li>`).join("");

/* ── Markets ───────────────────────────────────────────────────────── */

function tapeRowHTML(r) {
  const chg = (r.unit === "bp")
    ? (r.chg > 0 ? "+" : "−") + Math.abs(r.chg).toFixed(1) + "bp"
    : fmtPct(r.chg);
  const val = typeof r.value === "number"
    ? r.value.toLocaleString("en-US", { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals })
    : r.value;
  return `
    <li class="tg-row" ${r.live ? `data-live data-val="${r.value}" data-chg="${r.chg}" data-dp="${r.decimals}"` : ""}>
      <span class="tg-label">${r.label}</span>
      <span class="tg-val mono">${val}</span>
      <span class="tg-chg mono ${r.chg < 0 ? "neg" : "pos"}">${chg}</span>
    </li>`;
}

$("#tape-grid").innerHTML = UAA.markets.groups.map((g) => `
  <div class="tape-group">
    <p class="tg-name mono">${g.name}${g.live ? '<span class="live-dot" aria-hidden="true"></span>' : ""}</p>
    <ul>${g.rows.map(tapeRowHTML).join("")}</ul>
  </div>`).join("");

$("#sector-cells").innerHTML = UAA.markets.sectors.map((c) => {
  const mag = Math.min(24, Math.abs(c.v) * 16);
  const tone = c.v >= 0 ? "var(--positive)" : "var(--negative)";
  return `
    <div class="sector-cell ${c.v >= 0 ? "pos" : "neg"}" style="--cell: color-mix(in srgb, ${tone} ${mag.toFixed(0)}%, var(--surface))" tabindex="0" role="img" aria-label="${c.s} ${fmtPct(c.v, 1)}">
      <span class="mono">${c.s}</span><b class="mono">${fmtPct(c.v, 1)}</b>
    </div>`;
}).join("");

/* Live crypto tape — the only thing trading on a Saturday morning. */
function tickCrypto() {
  const rows = $$("[data-live]");
  if (!rows.length) return;
  const row = rows[Math.floor(Math.random() * rows.length)];
  const dp = parseInt(row.dataset.dp, 10);
  const val = parseFloat(row.dataset.val);
  const chg = parseFloat(row.dataset.chg);
  const drift = (Math.random() - 0.48) * 0.18; // percent
  const nv = val * (1 + drift / 100);
  const nchg = chg + drift;
  row.dataset.val = nv;
  row.dataset.chg = nchg;

  const valEl = $(".tg-val", row), chgEl = $(".tg-chg", row);
  valEl.textContent = nv.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  chgEl.textContent = fmtPct(nchg);
  chgEl.classList.toggle("neg", nchg < 0);
  chgEl.classList.toggle("pos", nchg >= 0);
  if (!reduceMotion) {
    valEl.classList.remove("flash-up", "flash-down");
    void valEl.offsetWidth;
    valEl.classList.add(drift >= 0 ? "flash-up" : "flash-down");
  }
}
setInterval(tickCrypto, 4200);

/* ── Reveal on scroll (stagger within a section, capped) ───────────── */

const revealObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("is-in");
    revealObs.unobserve(e.target);
  }
}, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

/* Deep links (any #hash) skip the arrival choreography: a reader landing
   mid-document gets the settled page, not a theater cue they scrolled past. */
const skipReveal = reduceMotion || location.hash.length > 1;
$$("[data-reveal]").forEach((el) => {
  if (skipReveal) el.classList.add("is-in");
  else revealObs.observe(el);
});

/* Sections whose child bars/rings draw when the section arrives. */
$$(".book-col, .tape-grid, .sector-strip").forEach((el) => {
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-in");
      obs.unobserve(e.target);
    }
  }, { threshold: 0.2 });
  if (skipReveal) el.classList.add("is-in");
  else obs.observe(el);
});

/* ── Section rail + reading progress ───────────────────────────────── */

const railLinks = new Map($$(".rail a").map((a) => [a.dataset.rail, a]));
const railObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    railLinks.forEach((a) => a.classList.remove("is-active"));
    const link = railLinks.get(e.target.id);
    if (link) link.classList.add("is-active");
  }
}, { rootMargin: "-38% 0px -52% 0px" });
["masthead", "verdict", "signals", "week", "book", "markets"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) railObs.observe(el);
});

const progressBar = $("#progress-bar");
let progressQueued = false;
addEventListener("scroll", () => {
  if (progressQueued) return;
  progressQueued = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progressBar.style.transform = "scaleX(" + (max > 0 ? scrollY / max : 0) + ")";
    progressQueued = false;
  });
}, { passive: true });

/* ── Clock ─────────────────────────────────────────────────────────── */

const clockEl = $("#clock");
function tickClock() {
  const d = new Date();
  clockEl.textContent = ["getHours", "getMinutes", "getSeconds"]
    .map((m) => String(d[m]()).padStart(2, "0")).join(":");
}
tickClock();
setInterval(tickClock, 1000);

/* ── Command palette ───────────────────────────────────────────────── */

const palette = {
  overlay: $("#palette"),
  input: $("#palette-input"),
  list: $("#palette-list"),
  opener: null,
  sel: 0,
  items: [],

  open(from) {
    this.opener = from || null;
    this.overlay.hidden = false;
    this.input.value = "";
    this.render("");
    this.input.focus();
    document.body.style.overflow = "hidden";
  },
  close() {
    this.overlay.hidden = true;
    document.body.style.overflow = "";
    if (this.opener) this.opener.focus();
  },
  render(q) {
    const query = q.trim().toLowerCase();
    this.items = UAA.palette.filter((p) => !query || p.label.toLowerCase().includes(query) || p.hint.toLowerCase().includes(query));
    this.sel = 0;
    this.list.innerHTML = this.items.length
      ? this.items.map((p, i) => `
          <li class="pal-item ${i === 0 ? "is-sel" : ""}" role="option" aria-selected="${i === 0}" data-i="${i}">
            <span class="pal-k mono">${p.k.toUpperCase()}</span>
            <span class="pal-label">${p.label}</span>
            <span class="pal-hint mono dim">${p.hint}</span>
          </li>`).join("")
      : `<li class="pal-empty">Nothing matches — the real palette also searches tickers and notes.</li>`;
    $$(".pal-item", this.list).forEach((el) => {
      el.addEventListener("pointermove", () => this.select(parseInt(el.dataset.i, 10)));
      el.addEventListener("click", () => this.run());
    });
  },
  select(i) {
    if (!this.items.length) return;
    this.sel = Math.max(0, Math.min(this.items.length - 1, i));
    $$(".pal-item", this.list).forEach((el, j) => {
      el.classList.toggle("is-sel", j === this.sel);
      el.setAttribute("aria-selected", String(j === this.sel));
    });
    const selEl = $$(".pal-item", this.list)[this.sel];
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  },
  run() {
    const item = this.items[this.sel];
    this.close();
    if (item) stub(item.label);
  },
};

$("#palette-open").addEventListener("click", (e) => palette.open(e.currentTarget));
palette.overlay.addEventListener("click", (e) => { if (e.target === palette.overlay) palette.close(); });
palette.input.addEventListener("input", (e) => palette.render(e.target.value));

addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.overlay.hidden ? palette.open($("#palette-open")) : palette.close();
    return;
  }
  if (palette.overlay.hidden) return;
  if (e.key === "Escape") { e.preventDefault(); palette.close(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); palette.select(palette.sel + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palette.select(palette.sel - 1); }
  else if (e.key === "Enter") { e.preventDefault(); palette.run(); }
});

/* ── Stubbed destinations ──────────────────────────────────────────── */

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-stub]");
  if (!el) return;
  e.preventDefault();
  stub(el.textContent.replace("→", "").trim());
});

/* Deep-linkable demo states: #open-01 expands the first signal,
   #ledger opens the sealed ledger. Useful for review and screenshots. */
if (location.hash === "#open-01") setTimeout(() => $(".signal-row").click(), 600);
if (location.hash === "#ledger") setTimeout(() => { ledgerToggle.click(); ledgerToggle.scrollIntoView({ block: "center" }); }, 600);
