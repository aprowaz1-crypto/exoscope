import type { BlsOptions, BlsPeak, BlsResult, BlsSpectrumPoint } from '../types';
import { clamp, logspace, meanStd, median } from './stats';

interface PeriodEvaluation {
  score: number;
  depth: number;
  durationDays: number;
  t0: number;
}

interface PreparedData {
  time: Float64Array;
  flux: Float64Array;
  weights: Float64Array;
  tRef: number;
  tMin: number;
  tMax: number;
  baseline: number;
  nBins: number;
}

function prepare(
  time: ArrayLike<number>,
  flux: ArrayLike<number>,
  err: ArrayLike<number>,
  nBins: number,
): PreparedData {
  const t: number[] = [];
  const f: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (
      Number.isFinite(time[i]) &&
      Number.isFinite(flux[i]) &&
      Number.isFinite(err[i]) &&
      err[i] > 0
    ) {
      t.push(time[i]);
      f.push(flux[i]);
      w.push(1 / (err[i] * err[i]));
    }
  }
  if (t.length < 8) throw new Error('Для BLS потрібно щонайменше 8 валідних точок.');
  const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const timeArr = new Float64Array(order.map((i) => t[i]));
  const fluxArr = new Float64Array(order.map((i) => f[i]));
  const weightArr = new Float64Array(order.map((i) => w[i]));
  return {
    time: timeArr,
    flux: fluxArr,
    weights: weightArr,
    tRef: timeArr[0],
    tMin: timeArr[0],
    tMax: timeArr[timeArr.length - 1],
    baseline: timeArr[timeArr.length - 1] - timeArr[0],
    nBins,
  };
}

function evaluatePeriod(
  prep: PreparedData,
  period: number,
  durations: Float64Array,
): PeriodEvaluation {
  const { time, flux, weights, tRef, nBins } = prep;
  const binW = new Float64Array(nBins);
  const binWY = new Float64Array(nBins);
  const binCount = new Uint32Array(nBins);
  for (let i = 0; i < time.length; i++) {
    let phase = ((time[i] - tRef) / period) % 1;
    if (phase < 0) phase += 1;
    const bin = Math.min(nBins - 1, Math.floor(phase * nBins));
    binW[bin] += weights[i];
    binWY[bin] += weights[i] * flux[i];
    binCount[bin]++;
  }
  const totalW = binW.reduce((a, b) => a + b, 0);
  const totalWY = binWY.reduce((a, b) => a + b, 0);
  const totalCount = binCount.reduce((a, b) => a + b, 0);
  const prefixW = new Float64Array(nBins * 2 + 1);
  const prefixWY = new Float64Array(nBins * 2 + 1);
  const prefixCount = new Uint32Array(nBins * 2 + 1);
  for (let i = 0; i < nBins * 2; i++) {
    const b = i % nBins;
    prefixW[i + 1] = prefixW[i] + binW[b];
    prefixWY[i + 1] = prefixWY[i] + binWY[b];
    prefixCount[i + 1] = prefixCount[i] + binCount[b];
  }
  let best: PeriodEvaluation = { score: 0, depth: 0, durationDays: 0, t0: tRef };
  for (let d = 0; d < durations.length; d++) {
    const duration = durations[d];
    const nb = Math.round((duration / period) * nBins);
    if (nb < 1 || nb > nBins * 0.45) continue;
    for (let start = 0; start < nBins; start++) {
      const end = start + nb;
      const inW = prefixW[end] - prefixW[start];
      const inWY = prefixWY[end] - prefixWY[start];
      const inCount = prefixCount[end] - prefixCount[start];
      const outW = totalW - inW;
      const outWY = totalWY - inWY;
      const outCount = totalCount - inCount;
      if (inW <= 0 || outW <= 0 || inCount < 2 || outCount < 5) continue;
      const meanIn = inWY / inW;
      const meanOut = outWY / outW;
      const depth = meanOut - meanIn;
      if (depth <= 0) continue;
      const sigma = Math.sqrt(1 / inW + 1 / outW);
      const score = depth / sigma;
      if (score > best.score) {
        const phaseCenter = (start + nb / 2) / nBins;
        let t0 = tRef + phaseCenter * period;
        while (t0 < prep.tMin) t0 += period;
        while (t0 >= prep.tMin + period) t0 -= period;
        best = { score, depth, durationDays: duration, t0 };
      }
    }
  }
  return best;
}

function localPeaks(
  spectrum: Float64Array,
  periods: Float64Array,
  details: PeriodEvaluation[],
  bestPeriod: number,
  maxPeaks = 6,
): BlsPeak[] {
  const candidates: BlsPeak[] = [];
  for (let i = 1; i < spectrum.length - 1; i++) {
    if (spectrum[i] >= spectrum[i - 1] && spectrum[i] > spectrum[i + 1] && spectrum[i] > 0) {
      candidates.push({
        period: periods[i],
        score: spectrum[i],
        depth: details[i].depth,
        durationDays: details[i].durationDays,
        t0: details[i].t0,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected: BlsPeak[] = [];
  for (const peak of candidates) {
    if (selected.length >= maxPeaks) break;
    if (selected.some((p) => Math.abs(Math.log(p.period / peak.period)) < 0.015)) continue;
    if (Math.abs(Math.log(peak.period / bestPeriod)) < 0.008) continue;
    selected.push(peak);
  }
  return selected;
}

export function blsSearch(
  time: ArrayLike<number>,
  flux: ArrayLike<number>,
  err: ArrayLike<number>,
  options: BlsOptions,
  onProgress?: (fraction: number, bestScore: number) => void,
): BlsResult {
  const nBins = Math.round(clamp(options.nBins || 300, 80, 800));
  const prep = prepare(time, flux, err, nBins);
  const minPeriod = Math.max(0.02, options.minPeriod);
  const maxPeriod = Math.min(options.maxPeriod, prep.baseline * 0.95);
  if (!(maxPeriod > minPeriod)) {
    throw new Error(
      `Діапазон періодів некоректний: min=${minPeriod.toFixed(3)} d, max=${maxPeriod.toFixed(3)} d.`,
    );
  }
  const periods = logspace(minPeriod, maxPeriod, Math.max(100, options.nPeriods));
  const durationMin = Math.max(0.01, options.minDurationHours / 24);
  const durationMax = Math.max(durationMin, Math.min(0.5, options.maxDurationHours / 24));
  const durations = logspace(durationMin, durationMax, 7);
  const spectrum = new Float64Array(periods.length);
  const details: PeriodEvaluation[] = new Array(periods.length);
  let best: BlsPeak = {
    period: periods[0],
    score: 0,
    depth: 0,
    durationDays: 0,
    t0: prep.tRef,
  };
  for (let i = 0; i < periods.length; i++) {
    const evaluation = evaluatePeriod(prep, periods[i], durations);
    details[i] = evaluation;
    spectrum[i] = evaluation.score;
    if (evaluation.score > best.score) {
      best = {
        period: periods[i],
        score: evaluation.score,
        depth: evaluation.depth,
        durationDays: evaluation.durationDays,
        t0: evaluation.t0,
      };
    }
    if (onProgress && (i % 20 === 0 || i === periods.length - 1)) {
      onProgress(((i + 1) / periods.length) * 0.92, best.score);
    }
  }
  // Refine the best period locally, preserving the BLS grid for the spectrum display.
  if (best.score > 0) {
    const step = periods.length > 1 ? periods[1] / periods[0] : 1.002;
    const lo = best.period / step ** 1.6;
    const hi = best.period * step ** 1.6;
    const fine = logspace(lo, hi, 81);
    const localDurations = new Float64Array(7);
    for (let i = 0; i < localDurations.length; i++) {
      const factor = 0.65 + i * 0.125;
      localDurations[i] = Math.max(durationMin, Math.min(durationMax, best.durationDays * factor));
    }
    let refined = best;
    for (const trial of fine) {
      const evaluation = evaluatePeriod(prep, trial, localDurations);
      if (evaluation.score > refined.score) {
        refined = {
          period: trial,
          score: evaluation.score,
          depth: evaluation.depth,
          durationDays: evaluation.durationDays,
          t0: evaluation.t0,
        };
      }
    }
    if (refined.score > 0) best = refined;
  }
  const scoreArray = Array.from(spectrum).filter((v) => Number.isFinite(v));
  const { mean, std } = meanStd(scoreArray);
  const med = median(scoreArray);
  const sde = std > 0 ? (best.score - med) / std : 0;
  const peakList = localPeaks(spectrum, periods, details, best.period);
  if (!peakList.some((p) => Math.abs(Math.log(p.period / best.period)) < 0.01)) {
    peakList.unshift({ ...best });
  } else {
    peakList[0] = { ...best, score: Math.max(best.score, peakList[0].score) };
  }
  const spectrumPoints: BlsSpectrumPoint[] = [];
  for (let i = 0; i < periods.length; i++) {
    spectrumPoints.push({ period: periods[i], score: spectrum[i] });
  }
  onProgress?.(1, best.score);
  return {
    best,
    peaks: peakList.slice(0, 6),
    spectrum: spectrumPoints,
    sde,
    baseline: prep.baseline,
    nPoints: prep.time.length,
    options: {
      ...options,
      minPeriod,
      maxPeriod,
    },
  };
}
