import type {
  LightCurve,
  PhotometryResult,
  TransitFit,
  VettingFlag,
  VettingResult,
} from '../types';

function weightedStats(
  values: number[],
  errors: number[],
): { mean: number; error: number } {
  let sw = 0;
  let swy = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || !Number.isFinite(errors[i]) || errors[i] <= 0) continue;
    const w = 1 / errors[i] ** 2;
    sw += w;
    swy += w * values[i];
  }
  if (sw <= 0) return { mean: NaN, error: NaN };
  return { mean: swy / sw, error: Math.sqrt(1 / sw) };
}

function meanStd(values: number[]): { mean: number; std: number; n: number } {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return { mean: NaN, std: NaN, n: 0 };
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, valid.length - 1);
  return { mean, std: Math.sqrt(variance), n: valid.length };
}

export function vetTransit(
  phot: PhotometryResult,
  lc: LightCurve,
  fit: TransitFit,
): VettingResult {
  const flags: VettingFlag[] = [];
  const { params, events } = fit;
  const n = lc.time.length;
  const target = phot.series[lc.targetIndex];

  const odd: Array<{ depth: number; error: number }> = [];
  const even: Array<{ depth: number; error: number }> = [];
  for (const event of events) {
    if (!Number.isFinite(event.depth) || !Number.isFinite(event.error) || event.error <= 0) continue;
    (Math.abs(event.epoch) % 2 === 0 ? even : odd).push(event);
  }
  const oddStats = weightedStats(
    odd.map((e) => e.depth),
    odd.map((e) => e.error),
  );
  const evenStats = weightedStats(
    even.map((e) => e.depth),
    even.map((e) => e.error),
  );
  const oddEvenSigma =
    Number.isFinite(oddStats.mean) && Number.isFinite(evenStats.mean)
      ? Math.abs(oddStats.mean - evenStats.mean) /
        Math.sqrt(oddStats.error ** 2 + evenStats.error ** 2)
      : NaN;
  if (odd.length && even.length) {
    if (oddEvenSigma > 3) {
      flags.push({
        id: 'odd-even',
        severity: 'bad',
        title: 'Різниця глибин парних і непарних транзитів',
        detail: `Глибини відрізняються на ${oddEvenSigma.toFixed(1)}σ. Це типово для затемнювальної подвійної або змішувальної зорі.`,
        value: `${oddEvenSigma.toFixed(1)}σ`,
      });
    } else {
      flags.push({
        id: 'odd-even',
        severity: 'good',
        title: 'Парні та непарні транзити узгоджені',
        detail: `Різниця глибин ${oddEvenSigma.toFixed(1)}σ — у межах очікуваного.`,
        value: `${oddEvenSigma.toFixed(1)}σ`,
      });
    }
  } else {
    flags.push({
      id: 'odd-even',
      severity: 'unknown',
      title: 'Недостатньо транзитів для odd–even',
      detail: 'Потрібно щонайменше по одному парному й непарному транзиту в базовій лінії.',
      value: `${events.length} подій`,
    });
  }

  // Secondary eclipse at phase 0.5.
  const outFlux: number[] = [];
  const outErr: number[] = [];
  const secondaryDepths: Array<{ depth: number; error: number; center: number }> = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(lc.time[i]) || !Number.isFinite(lc.flux[i]) || !Number.isFinite(lc.err[i])) continue;
    const k = Math.round((lc.time[i] - params.t0) / params.period);
    const primaryPhase = (lc.time[i] - (params.t0 + k * params.period)) / params.period;
    if (Math.abs(primaryPhase) > params.duration / params.period) {
      outFlux.push(lc.flux[i]);
      outErr.push(lc.err[i]);
    }
  }
  const out = weightedStats(outFlux, outErr);
  const kMin = Math.floor((lc.time[0] - params.t0) / params.period) - 1;
  const kMax = Math.ceil((lc.time[n - 1] - params.t0) / params.period) + 1;
  for (let k = kMin; k <= kMax; k++) {
    const center = params.t0 + (k + 0.5) * params.period;
    if (center < lc.time[0] - 5 * params.duration || center > lc.time[n - 1] + 5 * params.duration) continue;
    const values: number[] = [];
    const errors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(lc.time[i] - center) > params.duration / 2) continue;
      if (!Number.isFinite(lc.flux[i]) || !Number.isFinite(lc.err[i])) continue;
      values.push(lc.flux[i]);
      errors.push(lc.err[i]);
    }
    if (values.length < 2) continue;
    const inside = weightedStats(values, errors);
    if (!Number.isFinite(inside.mean) || !Number.isFinite(out.mean)) continue;
    secondaryDepths.push({
      center,
      depth: out.mean - inside.mean,
      error: Math.sqrt(inside.error ** 2 + out.error ** 2),
    });
  }
  const secondaryStats = weightedStats(
    secondaryDepths.map((s) => s.depth),
    secondaryDepths.map((s) => s.error),
  );
  const secondarySigma =
    Number.isFinite(secondaryStats.mean) && secondaryStats.error > 0
      ? secondaryStats.mean / secondaryStats.error
      : NaN;
  if (secondaryDepths.length && Number.isFinite(secondarySigma)) {
    if (secondarySigma > 3) {
      flags.push({
        id: 'secondary',
        severity: 'bad',
        title: 'Значущий вторинний мінімум',
        detail: `На фазі 0.5 видно затемнення ${(secondaryStats.mean * 1e6).toFixed(0)} ppm (${secondarySigma.toFixed(1)}σ). Можливий затемнювальний компаньйон або еліпсоїдальна змінність.`,
        value: `${secondarySigma.toFixed(1)}σ`,
      });
    } else {
      flags.push({
        id: 'secondary',
        severity: 'good',
        title: 'Вторинного мінімуму не виявлено',
        detail: `Границя на фазі 0.5: ${secondarySigma.toFixed(1)}σ.`,
        value: `${secondarySigma.toFixed(1)}σ`,
      });
    }
  } else {
    flags.push({
      id: 'secondary',
      severity: 'unknown',
      title: 'Вторинна фаза поза покриттям',
      detail: 'У базовій лінії не вистачило точок на фазі 0.5.',
    });
  }

  // Centroid motion: target relative to the comparison-star average.
  const compIndices = lc.ensembleIndices;
  const dx: number[] = [];
  const dy: number[] = [];
  const inMask: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(target.x[i]) || !Number.isFinite(target.y[i])) continue;
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const index of compIndices) {
      const series = phot.series[index];
      if (Number.isFinite(series.x[i]) && Number.isFinite(series.y[i])) {
        sx += series.x[i];
        sy += series.y[i];
        count++;
      }
    }
    if (count < 2) continue;
    dx.push(target.x[i] - sx / count);
    dy.push(target.y[i] - sy / count);
    const k = Math.round((lc.time[i] - params.t0) / params.period);
    const center = params.t0 + k * params.period;
    inMask.push(Math.abs(lc.time[i] - center) <= params.duration / 2);
  }
  const inX = dx.filter((_, i) => inMask[i]);
  const inY = dy.filter((_, i) => inMask[i]);
  const outX = dx.filter((_, i) => !inMask[i]);
  const outY = dy.filter((_, i) => !inMask[i]);
  const sx = meanStd(outX);
  const sy = meanStd(outY);
  const mx = meanStd(inX);
  const my = meanStd(inY);
  const sigX = sx.n > 3 ? Math.max(sx.std / Math.sqrt(sx.n) * Math.sqrt(1 + sx.n / Math.max(1, mx.n)), 1e-3) : NaN;
  const sigY = sy.n > 3 ? Math.max(sy.std / Math.sqrt(sy.n) * Math.sqrt(1 + sy.n / Math.max(1, my.n)), 1e-3) : NaN;
  const shiftX = mx.mean - sx.mean;
  const shiftY = my.mean - sy.mean;
  const centroidSigma =
    Number.isFinite(sigX) && Number.isFinite(sigY) && inX.length
      ? Math.hypot(shiftX / sigX, shiftY / sigY)
      : NaN;
  if (Number.isFinite(centroidSigma)) {
    if (centroidSigma > 3 || Math.hypot(shiftX, shiftY) > 0.4) {
      flags.push({
        id: 'centroid',
        severity: 'bad',
        title: 'Зсув центроїда під час транзиту',
        detail: `Положення цілі змінюється на (${shiftX.toFixed(2)}, ${shiftY.toFixed(2)}) px (${centroidSigma.toFixed(1)}σ) — можливий фоновий затемнювальний бінар або змішування.`,
        value: `${centroidSigma.toFixed(1)}σ`,
      });
    } else {
      flags.push({
        id: 'centroid',
        severity: 'good',
        title: 'Центроїд стабільний',
        detail: `Зсув під час транзиту ${centroidSigma.toFixed(1)}σ — джерело не «ходить» по кадру.`,
        value: `${centroidSigma.toFixed(1)}σ`,
      });
    }
  } else {
    flags.push({
      id: 'centroid',
      severity: 'unknown',
      title: 'Центроїд: замало даних',
      detail: 'Не вдалося виміряти диференціальний центроїд.',
    });
  }

  // Red noise: scatter of binned residuals compared with photon noise.
  const residualSigmas: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(fit.residuals[i]) && Number.isFinite(lc.err[i]) && lc.err[i] > 0) {
      residualSigmas.push(fit.residuals[i] / lc.err[i]);
    }
  }
  let redNoise = NaN;
  if (residualSigmas.length >= 30) {
    const bin = 10;
    const means: number[] = [];
    for (let i = 0; i + bin <= residualSigmas.length; i += bin) {
      const chunk = residualSigmas.slice(i, i + bin);
      means.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
    }
    const stats = meanStd(means);
    const expected = 1 / Math.sqrt(bin);
    redNoise = stats.std / expected;
    const severity = redNoise > 2 ? 'bad' : redNoise > 1.35 ? 'warn' : 'good';
    flags.push({
      id: 'red-noise',
      severity,
      title:
        severity === 'good'
          ? 'Шум близький до фотонного'
          : 'Підвищений корельований шум',
      detail: `Відношення розсіяння бінованих залишків до очікуваного: ${redNoise.toFixed(2)}.`,
      value: redNoise.toFixed(2),
    });
  } else {
    flags.push({
      id: 'red-noise',
      severity: 'unknown',
      title: 'Red noise: замало точок',
      detail: 'Потрібно ≥30 точок для оцінки корельованого шуму.',
    });
  }

  const shapeRatio = params.ingress / Math.max(params.duration, 1e-9);
  flags.push({
    id: 'shape',
    severity: shapeRatio > 0.65 ? 'warn' : 'good',
    title: shapeRatio > 0.65 ? 'V-подібний профіль' : 'U-подібний профіль',
    detail: `T12/T14 = ${shapeRatio.toFixed(2)}. Планетний транзит зазвичай має U-подібну форму з короткими входами.`,
    value: shapeRatio.toFixed(2),
  });

  const satFrames = Array.from(target.flags).filter((f) => f & 2).length;
  if (satFrames > 0.1 * n) {
    flags.push({
      id: 'saturation',
      severity: 'bad',
      title: 'Ціль насичена',
      detail: `Зоря насичена у ${satFrames} із ${n} кадрів. Апертурна фотометрія не передає глибину транзиту.`,
      value: `${Math.round((satFrames / n) * 100)}%`,
    });
  } else {
    flags.push({
      id: 'saturation',
      severity: 'good',
      title: 'Насичення не заважає',
      detail: satFrames ? `Насичені кадри: ${satFrames}.` : 'Насичених кадрів не виявлено.',
      value: `${satFrames}`,
    });
  }

  let nearest = Infinity;
  let nearestId = -1;
  for (const star of phot.stars) {
    if (star.id === lc.targetStar.id) continue;
    const sep = Math.hypot(star.x - lc.targetStar.x, star.y - lc.targetStar.y);
    if (sep < nearest) {
      nearest = sep;
      nearestId = star.id;
    }
  }
  if (nearest < lc.targetStar.fwhm * 2) {
    flags.push({
      id: 'blend',
      severity: nearest < lc.targetStar.fwhm * 1.4 ? 'bad' : 'warn',
      title: 'Можливе змішування зорі',
      detail: `Поруч із ціллю (${nearest.toFixed(1)} px) є зоря S${nearestId}. Її світло може потрапляти в апертуру.`,
      value: `${nearest.toFixed(1)} px`,
    });
  } else {
    flags.push({
      id: 'blend',
      severity: 'good',
      title: 'Ізольована ціль',
      detail: `Найближча зоря за ${nearest.toFixed(1)} px — поза апертурою.`,
      value: `${nearest.toFixed(1)} px`,
    });
  }

  if (events.length < 2) {
    flags.push({
      id: 'coverage',
      severity: 'warn',
      title: 'Лише одна транзитна подія',
      detail: `У базовій лінії ${events.length} подія(і). Для надійного періоду потрібно ≥2.`,
      value: `${events.length}`,
    });
  } else {
    flags.push({
      id: 'coverage',
      severity: 'good',
      title: 'Кілька транзитів у даних',
      detail: `Покрито ${events.length} транзитних подій.`,
      value: `${events.length}`,
    });
  }

  if (Number.isFinite(fit.snr)) {
    flags.push({
      id: 'snr',
      severity: fit.snr > 10 ? 'good' : fit.snr > 5 ? 'warn' : 'bad',
      title: 'Статистична значущість глибини',
      detail: `Глибина / похибка = ${fit.snr.toFixed(1)}. Для публікації зазвичай потрібно > 7–10.`,
      value: fit.snr.toFixed(1),
    });
  }

  const bad = flags.filter((f) => f.severity === 'bad').length;
  const warn = flags.filter((f) => f.severity === 'warn').length;
  let verdict: VettingResult['verdict'] = 'weak';
  if (events.length < 1 || !Number.isFinite(fit.snr)) verdict = 'insufficient';
  else if (bad >= 2) verdict = 'false-positive';
  else if (bad === 1) verdict = 'weak';
  else if (Number.isFinite(fit.snr) && fit.snr > 10 && warn === 0) verdict = 'strong';
  else if (Number.isFinite(fit.snr) && fit.snr > 5) verdict = 'candidate';
  const score = Math.max(
    0,
    Math.min(
      100,
      45 +
        (Number.isFinite(fit.snr) ? Math.min(25, fit.snr * 1.8) : 0) +
        Math.min(15, events.length * 4) +
        (bad === 0 ? 10 : -12 * bad) -
        warn * 4,
    ),
  );

  return {
    flags,
    verdict,
    score,
    oddEven: {
      depthOdd: oddStats.mean,
      depthEven: evenStats.mean,
      sigma: oddEvenSigma,
      nOdd: odd.length,
      nEven: even.length,
    },
    secondary: { depth: secondaryStats.mean, sigma: secondarySigma },
    centroid: { dx: shiftX, dy: shiftY, sigma: centroidSigma },
    redNoise,
    shapeRatio,
  };
}
