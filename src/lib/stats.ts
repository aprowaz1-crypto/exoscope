export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function linspace(a: number, b: number, n: number): Float64Array {
  const out = new Float64Array(Math.max(1, n));
  if (out.length === 1) {
    out[0] = a;
    return out;
  }
  const step = (b - a) / (out.length - 1);
  for (let i = 0; i < out.length; i++) out[i] = a + i * step;
  return out;
}

export function logspace(a: number, b: number, n: number): Float64Array {
  const out = new Float64Array(Math.max(1, n));
  if (out.length === 1) {
    out[0] = a;
    return out;
  }
  const la = Math.log10(a);
  const lb = Math.log10(b);
  const step = (lb - la) / (out.length - 1);
  for (let i = 0; i < out.length; i++) out[i] = 10 ** (la + i * step);
  return out;
}

/** Quickselect: partially sorts the first n entries so that entry k is in place. */
export function quickselect(values: Float64Array, n: number, k: number): number {
  let left = 0;
  let right = n - 1;
  while (left < right) {
    const pivot = values[(left + right) >> 1];
    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else break;
  }
  return values[k];
}

export function medianInPlace(values: Float64Array, n: number): number {
  if (n <= 0) return NaN;
  if (n === 1) return values[0];
  const mid = n >> 1;
  if (n % 2 === 0) {
    const hi = quickselect(values, n, mid);
    // Quickselect leaves the lower half partitioned; the max of it is the lower middle.
    let lo = -Infinity;
    for (let i = 0; i < mid; i++) if (values[i] > lo) lo = values[i];
    return 0.5 * (lo + hi);
  }
  return quickselect(values, n, mid);
}

export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return NaN;
  const tmp = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isFinite(v)) tmp[m++] = v;
  }
  return medianInPlace(tmp, m);
}

export function madSigma(values: ArrayLike<number>, center?: number): number {
  const med = center ?? median(values);
  if (!Number.isFinite(med)) return NaN;
  const dev = new Float64Array(values.length);
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) dev[m++] = Math.abs(v - med);
  }
  if (m === 0) return NaN;
  return 1.4826 * medianInPlace(dev, m);
}

export function meanStd(values: ArrayLike<number>, sample = false): { mean: number; std: number; n: number } {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    sum2 += v * v;
    n++;
  }
  if (n === 0) return { mean: NaN, std: NaN, n: 0 };
  const mean = sum / n;
  const denom = sample ? Math.max(1, n - 1) : n;
  const variance = Math.max(0, sum2 / denom - (mean * mean * n) / denom);
  return { mean, std: Math.sqrt(variance), n };
}

export interface ClipStats {
  mean: number;
  median: number;
  std: number;
  sigma: number;
  n: number;
  iterations: number;
}

export function sigmaClipStats(
  values: ArrayLike<number>,
  clip = 3,
  iterations = 5,
): ClipStats {
  let work = new Float64Array(values.length);
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) work[m++] = values[i];
  }
  let med = medianInPlace(work.slice(0, m), m);
  let sigma = madSigma(work.subarray(0, m), med);
  let mean = med;
  let it = 0;
  for (; it < iterations; it++) {
    if (!Number.isFinite(sigma) || sigma <= 0) break;
    const lo = med - clip * sigma;
    const hi = med + clip * sigma;
    const next = new Float64Array(m);
    let k = 0;
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const v = work[i];
      if (v >= lo && v <= hi) {
        next[k++] = v;
        sum += v;
      }
    }
    if (k === m || k < 3) break;
    work = next;
    m = k;
    mean = sum / m;
    med = medianInPlace(work.slice(0, m), m);
    sigma = madSigma(work.subarray(0, m), med);
  }
  return { mean, median: med, std: sigma, sigma, n: m, iterations: it };
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const tmp = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(values[i])) tmp[m++] = values[i];
  if (m === 0) return NaN;
  const k = clamp(Math.round(((m - 1) * p) / 100), 0, m - 1);
  return quickselect(tmp, m, k);
}

export function weightedMean(values: ArrayLike<number>, weights: ArrayLike<number>): number {
  let sw = 0;
  let swy = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights[i];
    const v = values[i];
    if (Number.isFinite(v) && Number.isFinite(w) && w > 0) {
      sw += w;
      swy += w * v;
    }
  }
  return sw > 0 ? swy / sw : NaN;
}

export function standardize(values: Float64Array): Float64Array {
  const { mean, std } = meanStd(values);
  const out = new Float64Array(values.length);
  if (!Number.isFinite(std) || std === 0) return out;
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - mean) / std;
  return out;
}

/** Solves A x = b with partial pivoting. Returns null for singular matrices. */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-14) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

export interface LinearFit {
  beta: number[];
  cov: number[][] | null;
  chi2: number;
  dof: number;
}

/** Weighted least squares for y = X beta, where X is an array of rows. */
export function weightedLinearFit(
  X: number[][],
  y: ArrayLike<number>,
  weights: ArrayLike<number>,
): LinearFit {
  const n = y.length;
  const p = X[0]?.length ?? 0;
  if (p === 0) return { beta: [], cov: null, chi2: NaN, dof: n };
  const AtA: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Atb = new Array(p).fill(0);
  let used = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(y[i])) continue;
    used++;
    const row = X[i];
    for (let j = 0; j < p; j++) {
      Atb[j] += w * row[j] * y[i];
      for (let k = 0; k <= j; k++) AtA[j][k] += w * row[j] * row[k];
    }
  }
  for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) AtA[j][k] = AtA[k][j];
  const beta = solveLinearSystem(AtA, Atb);
  if (!beta) return { beta: new Array(p).fill(0), cov: null, chi2: NaN, dof: used - p };
  let chi2 = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(y[i]) || !(weights[i] > 0)) continue;
    let model = 0;
    for (let j = 0; j < p; j++) model += beta[j] * X[i][j];
    chi2 += weights[i] * (y[i] - model) ** 2;
  }
  // Invert AtA for parameter covariance (used only for optional uncertainties).
  const inv: number[][] = [];
  let invertible = true;
  for (let j = 0; j < p; j++) {
    const unit = new Array(p).fill(0);
    unit[j] = 1;
    const col = solveLinearSystem(AtA, unit);
    if (!col) {
      invertible = false;
      break;
    }
    inv.push(col);
  }
  const cov = invertible ? Array.from({ length: p }, (_, r) => Array.from({ length: p }, (_, c) => inv[c][r])) : null;
  return { beta, cov, chi2, dof: used - p };
}

export interface BinnedSeries {
  time: Float64Array;
  flux: Float64Array;
  err: Float64Array;
  n: Float64Array;
}

export function weightedBin(
  time: ArrayLike<number>,
  flux: ArrayLike<number>,
  err: ArrayLike<number>,
  binDays: number,
): BinnedSeries {
  const n = time.length;
  if (!(binDays > 0)) {
    return {
      time: Float64Array.from(time as ArrayLike<number>),
      flux: Float64Array.from(flux as ArrayLike<number>),
      err: Float64Array.from(err as ArrayLike<number>),
      n: new Float64Array(n).fill(1),
    };
  }
  const t0 = time[0];
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(flux[i])) continue;
    const key = Math.floor((time[i] - t0) / binDays);
    const arr = groups.get(key);
    if (arr) arr.push(i);
    else groups.set(key, [i]);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const out: BinnedSeries = {
    time: new Float64Array(keys.length),
    flux: new Float64Array(keys.length),
    err: new Float64Array(keys.length),
    n: new Float64Array(keys.length),
  };
  keys.forEach((key, j) => {
    const idx = groups.get(key)!;
    let sw = 0;
    let swt = 0;
    let swf = 0;
    for (const i of idx) {
      const w = err[i] > 0 ? 1 / (err[i] * err[i]) : 1;
      sw += w;
      swt += w * time[i];
      swf += w * flux[i];
    }
    out.time[j] = swt / sw;
    out.flux[j] = swf / sw;
    out.err[j] = Math.sqrt(1 / sw);
    out.n[j] = idx.length;
  });
  return out;
}

export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function logit(p: number): number {
  const q = clamp(p, 1e-9, 1 - 1e-9);
  return Math.log(q / (1 - q));
}

export function tanhScale(x: number, range: number): number {
  return range * Math.tanh(x);
}

export function atanhScale(value: number, range: number): number {
  return Math.atanh(clamp(value / range, -0.999999, 0.999999));
}

export function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential(digits - 1);
  return value.toFixed(digits);
}
