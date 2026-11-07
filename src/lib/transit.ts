import type { BlsPeak, TransitFit, TransitParams } from '../types';
import { clamp, logit, sigmoid, solveLinearSystem } from './stats';

export function transitModelAt(time: number, params: TransitParams): number {
  const { period, t0, depth, duration } = params;
  if (!(duration > 0) || !(period > 0)) return 1;
  let dt = (time - t0) % period;
  if (dt > period / 2) dt -= period;
  if (dt < -period / 2) dt += period;
  const abs = Math.abs(dt);
  const half = duration / 2;
  if (abs >= half) return 1;
  const ingress = Math.min(Math.max(params.ingress, 0), duration);
  if (ingress <= 1e-9 || abs <= half - ingress) return 1 - depth;
  const x = (half - abs) / ingress;
  return 1 - depth * clamp(x, 0, 1);
}

export function transitModelArray(time: ArrayLike<number>, params: TransitParams): Float64Array {
  const out = new Float64Array(time.length);
  for (let i = 0; i < time.length; i++) {
    out[i] = Number.isFinite(time[i]) ? transitModelAt(time[i], params) : NaN;
  }
  return out;
}

interface NelderResult {
  x: number[];
  fx: number;
  iterations: number;
}

function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  steps: number[],
  maxIter = 1400,
): NelderResult {
  const n = x0.length;
  const simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const point = x0.slice();
    point[i] += steps[i];
    simplex.push(point);
  }
  let values = simplex.map((p) => {
    const v = f(p);
    return Number.isFinite(v) ? v : Number.MAX_VALUE / 10;
  });
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const sorted = order.map((i) => simplex[i]);
    const sortedValues = order.map((i) => values[i]);
    simplex.splice(0, simplex.length, ...sorted);
    values = sortedValues;
    const spread = Math.abs(values[n] - values[0]);
    let diameter = 0;
    for (let i = 1; i <= n; i++) {
      let d = 0;
      for (let j = 0; j < n; j++) d += (simplex[i][j] - simplex[0][j]) ** 2;
      diameter = Math.max(diameter, Math.sqrt(d));
    }
    if (spread <= 1e-11 * (Math.abs(values[0]) + 1) && diameter < 2e-4) break;
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    }
    const reflect = centroid.map((c, j) => c + (c - simplex[n][j]));
    const fr = f(reflect);
    if (fr < values[0]) {
      const expand = centroid.map((c, j) => c + 2 * (c - simplex[n][j]));
      const fe = f(expand);
      if (fe < fr) {
        simplex[n] = expand;
        values[n] = fe;
      } else {
        simplex[n] = reflect;
        values[n] = fr;
      }
    } else if (fr < values[n - 1]) {
      simplex[n] = reflect;
      values[n] = fr;
    } else {
      const contract = centroid.map((c, j) => c + 0.5 * (simplex[n][j] - c));
      const fc = f(contract);
      if (fc < values[n]) {
        simplex[n] = contract;
        values[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = f(simplex[i]);
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values));
  return { x: simplex[best], fx: values[best], iterations };
}

function weightedMeanAndError(
  flux: ArrayLike<number>,
  err: ArrayLike<number>,
  indices: number[],
): { mean: number; error: number; n: number } {
  let sw = 0;
  let swy = 0;
  for (const i of indices) {
    if (!Number.isFinite(flux[i]) || !Number.isFinite(err[i]) || err[i] <= 0) continue;
    const w = 1 / err[i] ** 2;
    sw += w;
    swy += w * flux[i];
  }
  return sw > 0 ? { mean: swy / sw, error: Math.sqrt(1 / sw), n: indices.length } : { mean: NaN, error: NaN, n: 0 };
}

export function fitTransit(
  time: ArrayLike<number>,
  flux: ArrayLike<number>,
  err: ArrayLike<number>,
  initial: BlsPeak,
): TransitFit {
  const n = time.length;
  const warnings: string[] = [];
  const initialDepth = clamp(initial.depth > 0 ? initial.depth : 0.01, 1e-5, 0.25);
  const initialDuration = clamp(initial.durationDays > 0 ? initial.durationDays : 0.08, 0.005, initial.period * 0.4);
  const initialRatio = 0.2;
  const p0 = initial.period;
  const depthMax = 0.3;
  const t14Max = Math.min(0.65, p0 * 0.45);
  const t14Min = 0.004;
  const periodRange = 0.025;
  const t0Range = 0.35 * p0;

  const qToParams = (q: number[]): TransitParams => {
    const period = p0 * (1 + periodRange * Math.tanh(q[4]));
    const t0 = initial.t0 + t0Range * Math.tanh(q[0]);
    const depth = depthMax * sigmoid(q[1]);
    const duration = t14Min + (t14Max - t14Min) * sigmoid(q[2]);
    const ratio = 0.01 + 0.99 * sigmoid(q[3]);
    return { period, t0, depth, duration, ingress: duration * ratio };
  };
  const paramsToQ = (params: TransitParams): number[] => [
    Math.atanh(clamp((params.t0 - initial.t0) / t0Range, -0.98, 0.98)),
    logit(params.depth / depthMax),
    logit((params.duration - t14Min) / (t14Max - t14Min)),
    logit((params.ingress / Math.max(params.duration, 1e-9) - 0.01) / 0.99),
    Math.atanh(clamp((params.period / p0 - 1) / periodRange, -0.98, 0.98)),
  ];
  let q0: number[];
  try {
    q0 = paramsToQ({
      period: p0,
      t0: initial.t0,
      depth: initialDepth,
      duration: initialDuration,
      ingress: initialDuration * initialRatio,
    });
  } catch {
    q0 = [0, -2, -2, -1.5, 0];
  }
  q0 = q0.map((v) => (Number.isFinite(v) ? v : 0));

  const objective = (q: number[]): number => {
    const params = qToParams(q);
    if (!(params.depth > 0) || !(params.duration > 0) || !(params.period > 0)) return 1e99;
    let chi2 = 0;
    let used = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(time[i]) || !Number.isFinite(flux[i]) || !Number.isFinite(err[i]) || err[i] <= 0) continue;
      const model = transitModelAt(time[i], params);
      chi2 += ((flux[i] - model) / err[i]) ** 2;
      used++;
    }
    return used >= 8 ? chi2 : 1e99;
  };

  const nm = nelderMead(objective, q0, [0.35, 0.35, 0.3, 0.3, 0.2], 1600);
  const params = qToParams(nm.x);
  let chi2 = 0;
  let used = 0;
  const modelFlux = new Float64Array(n).fill(NaN);
  const residuals = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(flux[i])) continue;
    const model = transitModelAt(time[i], params);
    modelFlux[i] = model;
    residuals[i] = flux[i] - model;
    if (Number.isFinite(err[i]) && err[i] > 0) {
      chi2 += (residuals[i] / err[i]) ** 2;
      used++;
    }
  }
  const dof = Math.max(1, used - 5);
  const reducedChi2 = chi2 / dof;
  let rms = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(residuals[i])) {
      rms += residuals[i] ** 2;
      count++;
    }
  }
  rms = count ? Math.sqrt(rms / count) * 1e6 : NaN;

  // Numerical covariance in transformed space, then delta-method errors for physical parameters.
  const h = 0.015;
  const m = q0.length;
  const hessian: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const f0 = objective(nm.x);
  for (let i = 0; i < m; i++) {
    const qi = nm.x.slice();
    qi[i] += h;
    const qm = nm.x.slice();
    qm[i] -= h;
    const fpi = objective(qi);
    const fmi = objective(qm);
    hessian[i][i] = (fpi - 2 * f0 + fmi) / (h * h);
    for (let j = i + 1; j < m; j++) {
      const qpp = nm.x.slice();
      qpp[i] += h;
      qpp[j] += h;
      const qpm = nm.x.slice();
      qpm[i] += h;
      qpm[j] -= h;
      const qmp = nm.x.slice();
      qmp[i] -= h;
      qmp[j] += h;
      const qmm = nm.x.slice();
      qmm[i] -= h;
      qmm[j] -= h;
      const value =
        (objective(qpp) - objective(qpm) - objective(qmp) + objective(qmm)) / (4 * h * h);
      hessian[i][j] = value;
      hessian[j][i] = value;
    }
  }
  const covQ: number[][] | null = (() => {
    for (let i = 0; i < m; i++) if (!(hessian[i][i] > 0)) return null;
    const invCols: number[][] = [];
    for (let j = 0; j < m; j++) {
      const unit = new Array(m).fill(0);
      unit[j] = 1;
      const column = solveLinearSystem(hessian, unit);
      if (!column) return null;
      invCols.push(column);
    }
    const scale = Math.max(1, reducedChi2);
    return Array.from({ length: m }, (_, r) =>
      Array.from({ length: m }, (_, c) => 2 * invCols[c][r] * scale),
    );
  })();
  const sigmaQ = new Array(m).fill(NaN);
  if (covQ) {
    for (let i = 0; i < m; i++) sigmaQ[i] = Math.sqrt(Math.max(0, covQ[i][i]));
  } else {
    for (let i = 0; i < m; i++) {
      sigmaQ[i] = hessian[i][i] > 0 ? Math.sqrt(2 / hessian[i][i]) : NaN;
    }
  }
  const s0 = sigmoid(nm.x[1]);
  const s2 = sigmoid(nm.x[2]);
  const s3 = sigmoid(nm.x[3]);
  const sech0 = 1 - Math.tanh(nm.x[0]) ** 2;
  const sech4 = 1 - Math.tanh(nm.x[4]) ** 2;
  const depthSigma = Math.abs(depthMax * s0 * (1 - s0)) * sigmaQ[1];
  const t0Sigma = Math.abs(t0Range * sech0) * sigmaQ[0];
  const durSigma = Math.abs((t14Max - t14Min) * s2 * (1 - s2)) * sigmaQ[2];
  const ratio = params.ingress / Math.max(params.duration, 1e-9);
  const ratioSigma = Math.abs(0.99 * s3 * (1 - s3)) * sigmaQ[3];
  const ingressSigma = Math.sqrt((ratio * durSigma) ** 2 + (params.duration * ratioSigma) ** 2);
  const periodSigma = Math.abs(p0 * periodRange * sech4) * sigmaQ[4];
  const errors: TransitFit['errors'] = {
    period: Number.isFinite(periodSigma) && periodSigma < p0 ? periodSigma : undefined,
    t0: Number.isFinite(t0Sigma) && t0Sigma < p0 ? t0Sigma : undefined,
    depth: Number.isFinite(depthSigma) && depthSigma < 0.5 ? depthSigma : undefined,
    duration: Number.isFinite(durSigma) && durSigma < 1 ? durSigma : undefined,
    ingress: Number.isFinite(ingressSigma) && ingressSigma < 1 ? ingressSigma : undefined,
  };

  const eventsMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(flux[i])) continue;
    const k = Math.round((time[i] - params.t0) / params.period);
    const center = params.t0 + k * params.period;
    if (Math.abs(time[i] - center) <= params.duration / 2) {
      const list = eventsMap.get(k);
      if (list) list.push(i);
      else eventsMap.set(k, [i]);
    }
  }
  const outIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(flux[i])) continue;
    const k = Math.round((time[i] - params.t0) / params.period);
    const center = params.t0 + k * params.period;
    if (Math.abs(time[i] - center) > params.duration) outIndices.push(i);
  }
  const outMean = weightedMeanAndError(flux, err, outIndices);
  const events: TransitFit['events'] = [];
  for (const [epoch, indices] of eventsMap.entries()) {
    const inside = weightedMeanAndError(flux, err, indices);
    if (!Number.isFinite(inside.mean) || !Number.isFinite(outMean.mean)) continue;
    const depth = outMean.mean - inside.mean;
    const error = Math.sqrt(inside.error ** 2 + outMean.error ** 2);
    events.push({
      epoch,
      center: params.t0 + epoch * params.period,
      depth,
      error,
      n: indices.length,
    });
  }
  events.sort((a, b) => a.epoch - b.epoch);

  if (params.depth < 3e-4) warnings.push('Глибина близька до нуля: переконливого транзиту не видно.');
  if (reducedChi2 > 4) warnings.push(`χ²/dof = ${reducedChi2.toFixed(1)} — модель погано описує дані або похибки занижені.`);
  if (Math.abs(Math.tanh(nm.x[4])) > 0.9) warnings.push('Період упирається в межу пошуку — розширте діапазон періодів.');
  if (events.length < 2) warnings.push('Покрито менше двох окремих транзитів.');
  if (ratio > 0.65) warnings.push('T12/T14 велике: профіль V-подібний, можлива змішувальна зоря або інша форма.');
  if (!covQ) warnings.push('Не вдалося оцінити коваріацію параметрів — похибки наближені.');

  return {
    params,
    errors,
    chi2,
    dof,
    rms,
    snr: errors.depth && errors.depth > 0 ? params.depth / errors.depth : NaN,
    modelFlux,
    residuals,
    events,
    periodAtBoundary: Math.abs(Math.tanh(nm.x[4])) > 0.9,
    warnings,
  };
}

export function phaseOf(time: number, period: number, t0: number): number {
  let phase = ((time - t0) / period + 0.5) % 1;
  if (phase < 0) phase += 1;
  return phase - 0.5;
}
