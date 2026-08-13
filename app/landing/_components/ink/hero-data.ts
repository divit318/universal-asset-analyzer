/**
 * Hero series bake math — pure functions shared by the build-time script
 * (scripts/build-hero-series.ts) and the unit tests. Nothing here touches
 * the network, the DOM, or WebGL: closes in, four normalized channels out.
 *
 * The channels drive the silk field's macro structure (ink/hero-field.ts):
 *   smooth — Gaussian-smoothed log price, min-max normalized to [0, 1].
 *            The elegant macro sweep; jaggedness is smoothed away here,
 *            at bake time, not hidden in the shader.
 *   deriv  — first derivative of `smooth`, robust-normalized to [-1, 1].
 *            Strong trend bends the sweep more (local field rotation).
 *   vol    — local volatility (rolling std of resampled log returns),
 *            robust-normalized to [0, 1]. Turbulent periods read as the
 *            sheet fanning wider with more internal separation.
 *   resid  — unsmoothed high-frequency residual (raw minus smooth),
 *            robust-normalized to [-1, 1]. Real detail survives in the
 *            texture at very low amplitude without dominating.
 *
 * Robust normalization uses the 95th percentile of magnitudes, then clamps:
 * a single crash day (2008, 2020) must register, not define the scale.
 */

export interface HeroSeriesAsset {
  index: string;
  symbol: string;
  source: string;
  start: string;
  end: string;
  points: number;
  smoothSigma: number;
  smooth: number[];
  deriv: number[];
  vol: number[];
  resid: number[];
}

/** Linear-interpolation resample of `values` onto `n` evenly spaced points. */
export function resampleLinear(values: number[], n: number): number[] {
  if (values.length === 0 || n <= 0) return [];
  if (values.length === 1) return new Array(n).fill(values[0]);
  const out = new Array<number>(n);
  const last = values.length - 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * last;
    const j = Math.min(last - 1, Math.floor(x));
    const f = x - j;
    out[i] = values[j] * (1 - f) + values[j + 1] * f;
  }
  return out;
}

/** Gaussian smoothing with edge clamping; sigma is in samples. */
export function gaussianSmooth(values: number[], sigma: number): number[] {
  if (sigma <= 0) return [...values];
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Array<number>(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = w;
    sum += w;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(values.length - 1, Math.max(0, i + k));
      acc += values[j] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

/** p-th quantile (0..1) of |values|, linear interpolation between ranks. */
export function magnitudeQuantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const mags = values.map(Math.abs).sort((a, b) => a - b);
  const x = p * (mags.length - 1);
  const j = Math.min(mags.length - 2, Math.floor(x));
  if (mags.length === 1) return mags[0];
  return mags[j] * (1 - (x - j)) + mags[j + 1] * (x - j);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Bake the four channels from a daily close series. `n` is the output
 * resolution (one row of the data texture); `sigma` is the smoothing
 * kernel width in output samples — at n=512 over ~19 years, one sample is
 * about two weeks, so sigma=8 smooths over roughly four months.
 */
export function buildHeroSeries(
  closes: number[],
  opts: { index: string; symbol: string; source: string; start: string; end: string; n?: number; sigma?: number },
): HeroSeriesAsset {
  const n = opts.n ?? 512;
  const sigma = opts.sigma ?? 8;
  if (closes.length < 32) throw new Error(`hero series: only ${closes.length} closes; refusing to bake a degenerate field`);
  const logs = closes.map((c) => {
    if (!(c > 0)) throw new Error("hero series: non-positive close in input");
    return Math.log(c);
  });
  const raw = resampleLinear(logs, n);
  const smoothRaw = gaussianSmooth(raw, sigma);

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of smoothRaw) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const smooth = smoothRaw.map((v) => round4((v - lo) / span));

  const derivRaw = smoothRaw.map((_, i) => {
    const a = smoothRaw[Math.max(0, i - 1)];
    const b = smoothRaw[Math.min(n - 1, i + 1)];
    return (b - a) / 2;
  });
  const dScale = magnitudeQuantile(derivRaw, 0.95) || 1;
  const deriv = derivRaw.map((v) => round4(clamp(v / dScale, -1, 1)));

  const residRaw = raw.map((v, i) => v - smoothRaw[i]);
  const rScale = magnitudeQuantile(residRaw, 0.95) || 1;
  const resid = residRaw.map((v) => round4(clamp(v / rScale, -1, 1)));

  const rets = raw.map((v, i) => (i === 0 ? 0 : v - raw[i - 1]));
  const W = 12;
  const volRaw = raw.map((_, i) => {
    const a = Math.max(1, i - W);
    const b = Math.min(n - 1, i + W);
    let mean = 0;
    for (let j = a; j <= b; j++) mean += rets[j];
    mean /= b - a + 1;
    let vv = 0;
    for (let j = a; j <= b; j++) vv += (rets[j] - mean) ** 2;
    return Math.sqrt(vv / (b - a + 1));
  });
  const vScale = magnitudeQuantile(volRaw, 0.95) || 1;
  const vol = volRaw.map((v) => round4(clamp(v / vScale, 0, 1)));

  return {
    index: opts.index,
    symbol: opts.symbol,
    source: opts.source,
    start: opts.start,
    end: opts.end,
    points: n,
    smoothSigma: sigma,
    smooth,
    deriv,
    vol,
    resid,
  };
}

/**
 * Pack the four channels into one RGBA byte row for the data texture:
 * R = smooth, G = deriv biased to [0,1], B = vol, A = resid biased.
 * The shader undoes the bias. 8 bits per channel is ample: these drive
 * geometry at amplitudes of a few percent of the hero's height.
 */
export function packHeroSeries(asset: Pick<HeroSeriesAsset, "smooth" | "deriv" | "vol" | "resid" | "points">): Uint8Array {
  const n = asset.points;
  const out = new Uint8Array(n * 4);
  const b = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let i = 0; i < n; i++) {
    out[i * 4] = b(asset.smooth[i]);
    out[i * 4 + 1] = b(asset.deriv[i] * 0.5 + 0.5);
    out[i * 4 + 2] = b(asset.vol[i]);
    out[i * 4 + 3] = b(asset.resid[i] * 0.5 + 0.5);
  }
  return out;
}
