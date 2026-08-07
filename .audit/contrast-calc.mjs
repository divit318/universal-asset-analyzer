const hex = (h) => {
  h = h.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lum = ([r, g, b]) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const l1 = lum(hex(a)), l2 = lum(hex(b));
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
};
const surfaces = { bg: "#f7f8fa", surface: "#ffffff", s2: "#f4f6f9", s3: "#e9edf2" };
const candidates = {
  "faint current": "#8a94a2",
  "faint #6b7686": "#6b7686",
  "faint #68727f": "#68727f",
  "faint #656f7d": "#656f7d",
  "muted current": "#56606f",
  "warning current": "#c2540a",
  "warning #b34d09": "#b34d09",
  "warning #ad4a08": "#ad4a08",
  "warning #a84807": "#a84807",
  "sky-700 #0369a1": "#0369a1",
  "sky-750 #075e8d": "#075e8d",
  "amber-700 #b45309": "#b45309",
  "amber-750 #9f4a08": "#9f4a08",
  "yellow-700 #a16207": "#a16207",
  "yellow-750 #8f5606": "#8f5606",
  "emerald-700 #047857": "#047857",
  "emerald-600 #059669": "#059669",
  "blue-700 #1d4ed8": "#1d4ed8",
  "blue-600 #2563eb": "#2563eb",
  "purple-600 #9333ea": "#9333ea",
  "purple-700 #7e22ce": "#7e22ce",
  "cyan-700 #0e7490": "#0e7490",
  "cyan-800 #155e75": "#155e75",
  "teal-700 #0f766e": "#0f766e",
  "slate-600 #475569": "#475569",
  "red-600 #dc2626": "#dc2626",
  "red-700 #b91c1c": "#b91c1c",
  "orange-700 #c2410c": "#c2410c",
  "orange-800 #9a3412": "#9a3412",
  "pink-700 #be185d": "#be185d",
  "violet-700 #6d28d9": "#6d28d9",
  "violet-600 #7c3aed": "#7c3aed",
  "green-700 #15803d": "#15803d",
  "rose-600 #e11d48": "#e11d48",
  "rose-700 #be123c": "#be123c",
  "amber-600 #d97706": "#d97706",
  "yellow-500 #eab308": "#eab308",
  "regime bull #22c55e": "#22c55e",
  "regime blue #3b82f6": "#3b82f6",
  "regime amber #f59e0b": "#f59e0b",
  "regime red #ef4444": "#ef4444",
  "chart2L #2563eb": "#2563eb",
};
let out = "color".padEnd(24) + Object.keys(surfaces).map((s) => s.padEnd(9)).join("");
console.log(out);
for (const [name, c] of Object.entries(candidates)) {
  console.log(
    name.padEnd(24) + Object.values(surfaces).map((s) => String(ratio(c, s)).padEnd(9)).join(""),
  );
}
