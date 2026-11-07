import type {
  LightCurve,
  LcOptions,
  PhotometryResult,
  StarSeries,
} from '../types';
import { madSigma, median, weightedLinearFit } from './stats';

interface StarMetric {
  index: number;
  medianFlux: number;
  medianErr: number;
  rms: number;
  validFrac: number;
  satFrac: number;
  bright: number;
}

function starMetric(series: StarSeries, index: number): StarMetric {
  let valid = 0;
  let saturated = 0;
  const fluxValues: number[] = [];
  const normValues: number[] = [];
  const relErr: number[] = [];
  for (let i = 0; i < series.flux.length; i++) {
    const f = series.flux[i];
    const e = series.fluxErr[i];
    if (Number.isFinite(f) && f > 0 && Number.isFinite(e) && e > 0) {
      valid++;
      fluxValues.push(f);
      relErr.push(e / f);
    }
    if (series.flags[i] & 2) saturated++;
  }
  const n = series.flux.length;
  const medianFlux = median(fluxValues);
  const medianErr = median(relErr);
  let rms = NaN;
  if (Number.isFinite(medianFlux) && medianFlux > 0) {
    for (let i = 0; i < n; i++) {
      const f = series.flux[i];
      if (Number.isFinite(f) && f > 0) normValues.push(f / medianFlux);
    }
    rms = normValues.length > 3 ? madSigma(normValues) : NaN;
  }
  return {
    index,
    medianFlux,
    medianErr,
    rms,
    validFrac: n ? valid / n : 0,
    satFrac: n ? saturated / n : 1,
    bright: Number.isFinite(medianFlux) ? medianFlux : 0,
  };
}

function buildBasis(
  phot: PhotometryResult,
  target: StarSeries,
  options: LcOptions,
  time: Float64Array,
  validMask: Uint8Array,
): { X: number[][]; names: string[]; warnings: string[] } {
  const n = time.length;
  const warnings: string[] = [];
  let tmin = Infinity;
  let tmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!validMask[i]) continue;
    tmin = Math.min(tmin, time[i]);
    tmax = Math.max(tmax, time[i]);
  }
  const span = tmax - tmin || 1;
  const X: number[][] = Array.from({ length: n }, () => []);
  const names: string[] = ['1'];
  const baseT = (i: number): number => (2 * (time[i] - tmin)) / span - 1;
  for (let i = 0; i < n; i++) X[i].push(1);
  if (options.detrendOrder >= 1) {
    names.push('t');
    for (let i = 0; i < n; i++) X[i].push(baseT(i));
  }
  if (options.detrendOrder >= 2) {
    names.push('t²');
    for (let i = 0; i < n; i++) X[i].push(baseT(i) ** 2);
  }

  const addRegressor = (name: string, values: Float64Array): void => {
    let count = 0;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      if (!validMask[i] || !Number.isFinite(values[i])) continue;
      count++;
      sum += values[i];
      sum2 += values[i] * values[i];
    }
    if (count < 10 || count < 0.5 * n) {
      warnings.push(`Регресор «${name}» пропущено: замало значень.`);
      return;
    }
    const mean = sum / count;
    const variance = Math.max(0, sum2 / count - mean * mean);
    const sigma = Math.sqrt(variance);
    names.push(name);
    for (let i = 0; i < n; i++) {
      X[i].push(sigma > 0 && Number.isFinite(values[i]) ? (values[i] - mean) / sigma : 0);
    }
  };

  if (options.useFwhm) addRegressor('FWHM', target.fwhm);
  if (options.useSky) addRegressor('небо', target.sky);
  if (options.useAirmass) addRegressor('airmass', phot.frameAirmass);
  if (options.useCentroid) {
    addRegressor('x', target.x);
    addRegressor('y', target.y);
  }
  return { X, names, warnings };
}

export function buildLightCurve(phot: PhotometryResult, options: LcOptions): LightCurve {
  const targetIndex = options.targetIndex;
  const target = phot.series[targetIndex];
  if (!target) throw new Error('Цільову зорю не вибрано.');
  const n = phot.times.length;
  const warnings: string[] = [];
  const metrics = phot.series.map((series, index) => starMetric(series, index));
  const targetStar = phot.stars[targetIndex];
  const candidates = metrics.filter(
    (m) =>
      m.index !== targetIndex &&
      m.validFrac > 0.6 &&
      m.medianFlux > 0 &&
      Number.isFinite(m.medianErr) &&
      m.medianErr < 0.5 &&
      m.satFrac < 0.2 &&
      Number.isFinite(m.rms) &&
      phot.stars[m.index].elongation < 2.5,
  );
  // Avoid comparison stars whose apertures overlap the target.
  const separationLimit = Math.max(4, targetStar.fwhm * 3.5);
  const notBlended = candidates.filter((m) => {
    const s = phot.stars[m.index];
    const sep = Math.hypot(s.x - targetStar.x, s.y - targetStar.y);
    return sep > separationLimit;
  });
  const pool = notBlended.length >= 3 ? notBlended : candidates;
  const rmsValues = pool.map((m) => m.rms).filter((v) => Number.isFinite(v) && v > 0);
  const typicalRms = rmsValues.length ? median(rmsValues) : 0.01;
  const rmsLimit = Math.max(0.004, typicalRms * Math.max(1.5, options.variableClip));
  let selected = pool.filter((m) => m.rms <= rmsLimit);
  if (selected.length < 3) {
    selected = [...pool].sort((a, b) => a.rms - b.rms).slice(0, 10);
    warnings.push(
      'Стабільних зірок порівняння мало — використано найкращі доступні. Перевірте діаграму й виберіть іншу ціль за потреби.',
    );
  }
  selected.sort((a, b) => b.medianFlux - a.medianFlux);
  selected = selected.slice(0, 40);
  const ensembleIndices = selected.map((m) => m.index);
  if (ensembleIndices.length < 2) {
    warnings.push('Менше двох зірок порівняння: диференціальна фотометрія вироджена.');
  }
  if (metrics[targetIndex].satFrac > 0.1) {
    warnings.push(
      `Цільова зоря насичена у ${(metrics[targetIndex].satFrac * 100).toFixed(0)}% кадрів — глибина транзиту буде спотворена.`,
    );
  }
  const filteredVariable = pool.length - selected.length;
  if (filteredVariable > 0) {
    warnings.push(`Відсіяно ${filteredVariable} змінних/шумних зірок порівняння за RMS.`);
  }

  const weights = new Float64Array(ensembleIndices.length);
  const medianErrors = ensembleIndices.map((index) => metrics[index].medianErr);
  const validErrors = medianErrors.filter((v) => Number.isFinite(v) && v > 0);
  const typicalError = validErrors.length ? median(validErrors) : 0.01;
  for (let j = 0; j < ensembleIndices.length; j++) {
    const rel = metrics[ensembleIndices[j]].medianErr;
    const safe = Number.isFinite(rel) && rel > 0 ? rel : typicalError;
    weights[j] = 1 / (safe * safe);
  }
  const maxWeight = weights.length ? Math.max(...weights) : 0;
  const cap = maxWeight * 0.2;
  for (let j = 0; j < weights.length; j++) weights[j] = Math.min(weights[j], cap);

  const flux = new Float64Array(n).fill(NaN);
  const err = new Float64Array(n).fill(NaN);
  const raw = new Float64Array(n).fill(NaN);
  let noEnsembleFrames = 0;
  const targetMedian = metrics[targetIndex].medianFlux;

  for (let i = 0; i < n; i++) {
    const tf = target.flux[i];
    const te = target.fluxErr[i];
    if (!Number.isFinite(tf) || !Number.isFinite(te) || tf <= 0 || !(targetMedian > 0)) continue;
    const tNorm = tf / targetMedian;
    const tRel = Math.max(te / tf, 1e-6);
    const values: number[] = [];
    const relErrors: number[] = [];
    const weightList: number[] = [];
    const memberPositions: number[] = [];
    for (let j = 0; j < ensembleIndices.length; j++) {
      const series = phot.series[ensembleIndices[j]];
      const f = series.flux[i];
      const e = series.fluxErr[i];
      const med = metrics[ensembleIndices[j]].medianFlux;
      if (!Number.isFinite(f) || !Number.isFinite(e) || f <= 0 || !(med > 0)) continue;
      values.push(f / med);
      relErrors.push(Math.max(e / f, 1e-6));
      weightList.push(weights[j]);
      memberPositions.push(j);
    }
    let ens = 1;
    let ensErr = 0;
    if (values.length > 0) {
      let active = values.map(() => true);
      for (let iter = 0; iter < 3; iter++) {
        let sw = 0;
        let swv = 0;
        for (let k = 0; k < values.length; k++) {
          if (!active[k]) continue;
          sw += weightList[k];
          swv += weightList[k] * values[k];
        }
        if (sw <= 0) break;
        const mean = swv / sw;
        let swd = 0;
        for (let k = 0; k < values.length; k++) {
          if (!active[k]) continue;
          swd += weightList[k] * (values[k] - mean) ** 2;
        }
        const scatter = Math.sqrt(swd / sw);
        let clipped = false;
        const limit = Math.max(
          options.clipSigma * Math.max(scatter, typicalError),
          options.clipSigma * typicalError,
        );
        for (let k = 0; k < values.length; k++) {
          if (active[k] && Math.abs(values[k] - mean) > limit) {
            active[k] = false;
            clipped = true;
          }
        }
        if (!clipped) break;
      }
      let sw = 0;
      let swv = 0;
      let sw2e = 0;
      let used = 0;
      for (let k = 0; k < values.length; k++) {
        if (!active[k]) continue;
        used++;
        sw += weightList[k];
        swv += weightList[k] * values[k];
        sw2e += (weightList[k] * relErrors[k]) ** 2;
      }
      if (used > 0 && sw > 0) {
        ens = swv / sw;
        ensErr = Math.sqrt(sw2e) / sw;
      }
    } else {
      noEnsembleFrames++;
    }
    if (!(ens > 0) || !Number.isFinite(ens)) {
      ens = 1;
      ensErr = 0;
    }
    const value = tNorm / ens;
    if (!Number.isFinite(value) || value <= 0) continue;
    flux[i] = value;
    err[i] = value * Math.hypot(tRel, ensErr);
    raw[i] = value;
  }

  if (noEnsembleFrames > 0) {
    warnings.push(`У ${noEnsembleFrames} кадрах не було жодної зорі порівняння.`);
  }

  const validMask = new Uint8Array(n);
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(flux[i]) && flux[i] > 0 && Number.isFinite(err[i]) && err[i] > 0) {
      validMask[i] = 1;
      validCount++;
    }
  }
  if (validCount < 10) warnings.push('Замало валідних точок кривої світла.');

  let detrended = false;
  if (options.detrendOrder > 0 || options.useFwhm || options.useSky || options.useAirmass || options.useCentroid) {
    const basis = buildBasis(phot, target, options, phot.times, validMask);
    warnings.push(...basis.warnings);
    const { X } = basis;
    const inliers = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (validMask[i]) inliers[i] = 1;
    let beta: number[] | null = null;
    for (let iter = 0; iter < 4; iter++) {
      const Xfit: number[][] = [];
      const yfit: number[] = [];
      const wfit: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!inliers[i]) continue;
        Xfit.push(X[i]);
        yfit.push(flux[i]);
        wfit.push(1 / err[i] ** 2);
      }
      if (Xfit.length < X[0].length + 2) break;
      const fit = weightedLinearFit(Xfit, yfit, wfit);
      beta = fit.beta;
      let changed = false;
      for (let i = 0; i < n; i++) {
        if (!validMask[i]) continue;
        let model = 0;
        for (let j = 0; j < beta.length; j++) model += beta[j] * X[i][j];
        const resid = flux[i] - model;
        const keep = Math.abs(resid) <= Math.max(options.clipSigma * err[i], 1e-8);
        if (inliers[i] && !keep) {
          inliers[i] = 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (beta && beta.length) {
      const trend = new Float64Array(n).fill(1);
      let meanModel = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        if (!inliers[i]) continue;
        let model = 0;
        for (let j = 0; j < beta.length; j++) model += beta[j] * X[i][j];
        if (Number.isFinite(model)) {
          trend[i] = model;
          meanModel += model;
          count++;
        }
      }
      meanModel = count ? meanModel / count : 1;
      if (Number.isFinite(meanModel) && Math.abs(meanModel) > 1e-9) {
        for (let i = 0; i < n; i++) {
          if (!validMask[i]) continue;
          const t = trend[i] / meanModel;
          if (Number.isFinite(t) && Math.abs(t) > 1e-6) {
            flux[i] /= t;
            err[i] /= Math.abs(t);
          }
        }
        detrended = true;
      }
    }
  }

  const finiteFlux = Array.from(flux).filter((v) => Number.isFinite(v) && v > 0);
  const norm = finiteFlux.length ? median(finiteFlux) : 1;
  if (Number.isFinite(norm) && norm > 0) {
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(flux[i])) continue;
      flux[i] /= norm;
      err[i] /= norm;
    }
  }

  if (phot.timeSpanDays > 0 && phot.timeSpanDays < 0.08) {
    warnings.push('Базова лінія коротша за 2 години — пошук періодів буде ненадійним.');
  }

  return {
    time: phot.times,
    flux,
    err,
    raw,
    targetIndex,
    targetStar,
    ensembleIndices,
    ensembleIds: ensembleIndices.map((i) => phot.stars[i].id),
    detrended,
    binMinutes: options.binMinutes,
    timeLabel: phot.timesAreAbsolute ? 'JD' : 't',
    timesAreAbsolute: phot.timesAreAbsolute,
    warnings,
  };
}
