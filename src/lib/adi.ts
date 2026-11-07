import type {
  ContrastPoint,
  Frame,
  ImagingCandidate,
  ImagingResult,
  ImagingSettings,
} from '../types';
import { clamp, madSigma, median, medianInPlace, percentile } from './stats';

export interface BrightestStar {
  x: number;
  y: number;
  peak: number;
  background: number;
  noise: number;
}

function sampleBilinear(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = data[y0 * width + x0];
  const v10 = data[y0 * width + x1];
  const v01 = data[y1 * width + x0];
  const v11 = data[y1 * width + x1];
  let sum = 0;
  let wsum = 0;
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const vals = [v00, v10, v01, v11];
  for (let i = 0; i < 4; i++) {
    if (Number.isFinite(vals[i])) {
      sum += vals[i] * weights[i];
      wsum += weights[i];
    }
  }
  return wsum > 0 ? sum / wsum : NaN;
}

export function findBrightestCentroid(frame: Frame): BrightestStar {
  const { data, width, height } = frame;
  const values: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 50_000));
  for (let i = 0; i < data.length; i += stride) {
    if (Number.isFinite(data[i])) values.push(data[i]);
  }
  const background = median(values);
  const noise = madSigma(values, background) || 1e-6;
  // 5x5 box filter, implemented with a summed-area table.
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x];
      row += Number.isFinite(v) ? v : 0;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const box = 2;
  let bestX = Math.floor(width / 2);
  let bestY = Math.floor(height / 2);
  let bestSum = -Infinity;
  for (let y = box; y < height - box; y++) {
    for (let x = box; x < width - box; x++) {
      const sum =
        integral[(y + box + 1) * (width + 1) + x + box + 1] -
        integral[(y - box) * (width + 1) + x + box + 1] -
        integral[(y + box + 1) * (width + 1) + x - box] +
        integral[(y - box) * (width + 1) + x - box];
      if (sum > bestSum) {
        bestSum = sum;
        bestX = x;
        bestY = y;
      }
    }
  }
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let peak = -Infinity;
  for (let dy = -5; dy <= 5; dy++) {
    const y = bestY + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -5; dx <= 5; dx++) {
      const x = bestX + dx;
      if (x < 0 || x >= width) continue;
      const value = data[y * width + x];
      if (!Number.isFinite(value)) continue;
      if (value > peak) peak = value;
      const w = Math.max(0, value - background);
      sw += w;
      sx += w * x;
      sy += w * y;
    }
  }
  return {
    x: sw > 0 ? sx / sw : bestX,
    y: sw > 0 ? sy / sw : bestY,
    peak: peak - background,
    background,
    noise,
  };
}

export function shiftImage(
  data: Float32Array,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
): Float32Array {
  const out = new Float32Array(width * height).fill(NaN);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = sampleBilinear(data, width, height, x - shiftX, y - shiftY);
      out[y * width + x] = value;
    }
  }
  return out;
}

export function rotateImage(
  data: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  angleRad: number,
): Float32Array {
  const out = new Float32Array(width * height).fill(NaN);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      out[y * width + x] = sampleBilinear(data, width, height, sx, sy);
    }
  }
  return out;
}

function medianStack(frames: Float32Array[], width: number, height: number): Float32Array {
  const n = frames.length;
  const out = new Float32Array(width * height);
  const scratch = new Float64Array(n);
  for (let p = 0; p < out.length; p++) {
    let m = 0;
    for (let f = 0; f < n; f++) {
      const v = frames[f][p];
      if (Number.isFinite(v)) scratch[m++] = v;
    }
    out[p] = medianInPlace(scratch, m);
  }
  return out;
}

function meanStack(frames: Float32Array[], width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  const counts = new Uint16Array(width * height);
  for (const frame of frames) {
    for (let p = 0; p < out.length; p++) {
      const v = frame[p];
      if (Number.isFinite(v)) {
        out[p] += v;
        counts[p]++;
      }
    }
  }
  for (let p = 0; p < out.length; p++) {
    if (counts[p] > 0) out[p] /= counts[p];
    else out[p] = NaN;
  }
  return out;
}

interface RadialBin {
  r: number;
  sigma: number;
  count: number;
}

function radialNoise(
  data: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  minSep: number,
  maxSep: number,
  binWidth: number,
): RadialBin[] {
  const nBins = Math.max(1, Math.ceil((maxSep - minSep) / binWidth));
  const buckets: number[][] = Array.from({ length: nBins }, () => []);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r < minSep || r > maxSep) continue;
      const value = data[y * width + x];
      if (!Number.isFinite(value)) continue;
      const index = clamp(Math.floor((r - minSep) / binWidth), 0, nBins - 1);
      buckets[index].push(value);
    }
  }
  return buckets.map((values, index) => {
    const med = median(values);
    const sigma = values.length > 5 ? madSigma(values, med) : 0;
    return {
      r: minSep + (index + 0.5) * binWidth,
      sigma: Number.isFinite(sigma) ? sigma : 0,
      count: values.length,
    };
  });
}

function interpolateSigma(bins: RadialBin[], r: number): number {
  if (!bins.length) return 0;
  if (r <= bins[0].r) return bins[0].sigma;
  if (r >= bins[bins.length - 1].r) return bins[bins.length - 1].sigma;
  for (let i = 1; i < bins.length; i++) {
    if (r <= bins[i].r) {
      const a = bins[i - 1];
      const b = bins[i];
      const t = (r - a.r) / Math.max(1e-9, b.r - a.r);
      return a.sigma + (b.sigma - a.sigma) * t;
    }
  }
  return bins[bins.length - 1].sigma;
}

export function findCandidates(
  combined: Float32Array,
  snrMap: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  minSep: number,
  maxSep: number,
  threshold: number,
  starPeak: number,
  bins: RadialBin[],
  pixelScale: number,
): ImagingCandidate[] {
  const raw: Array<{ x: number; y: number; snr: number; r: number }> = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r < minSep || r > maxSep) continue;
      const value = snrMap[y * width + x];
      if (!Number.isFinite(value) || value < threshold) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (snrMap[(y + dy) * width + x + dx] > value) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) raw.push({ x, y, snr: value, r });
    }
  }
  raw.sort((a, b) => b.snr - a.snr);
  const selected: ImagingCandidate[] = [];
  const minDist = Math.max(4, minSep * 0.2);
  for (const candidate of raw) {
    if (selected.length >= 20) break;
    if (selected.some((c) => Math.hypot(c.x - candidate.x, c.y - candidate.y) < minDist)) continue;
    // Refine the centroid with positive residuals in a 5x5 box.
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let peak = -Infinity;
    let peakX = candidate.x;
    let peakY = candidate.y;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = candidate.x + dx;
        const y = candidate.y + dy;
        const value = combined[y * width + x];
        if (!Number.isFinite(value)) continue;
        if (value > peak) {
          peak = value;
          peakX = x;
          peakY = y;
        }
        const w = Math.max(0, value);
        sw += w;
        sx += w * x;
        sy += w * y;
      }
    }
    const x = sw > 0 ? sx / sw : candidate.x;
    const y = sw > 0 ? sy / sw : candidate.y;
    const r = Math.hypot(x - cx, y - cy);
    if (r < minSep || r > maxSep) continue;
    const contrast = peak / Math.max(starPeak, 1e-12);
    selected.push({
      id: selected.length + 1,
      x,
      y,
      sepPx: r,
      sepArcsec: r * pixelScale,
      pa: ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360,
      snr: snrMap[Math.round(peakY) * width + Math.round(peakX)],
      contrast,
      contrastMag: -2.5 * Math.log10(Math.max(contrast, 1e-12)),
    });
  }
  return selected;
}

export interface AdiRunInput {
  frames: Frame[];
  settings: ImagingSettings;
  pixelScale: number;
  onProgress?: (value: number, label: string) => void;
}

function chooseFrames(frames: Frame[], maxFrames: number): Frame[] {
  if (frames.length <= maxFrames) return frames;
  const selected: Frame[] = [];
  for (let i = 0; i < maxFrames; i++) {
    selected.push(frames[Math.round((i * (frames.length - 1)) / (maxFrames - 1))]);
  }
  return selected;
}

export async function runAdi(input: AdiRunInput): Promise<ImagingResult> {
  const start = performance.now();
  const settings = input.settings;
  const frames = chooseFrames(input.frames, Math.max(3, settings.maxFrames));
  if (frames.length < 2) throw new Error('Для прямого зображення потрібно щонайменше 2 кадри.');
  const ref = frames[0];
  const { width, height } = ref;
  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error('Усі кадри для ADI повинні мати однаковий розмір.');
    }
  }
  const warnings: string[] = [];
  input.onProgress?.(0.03, 'Пошук центральної зорі');
  const brightest = findBrightestCentroid(ref);
  const refBrightest = { x: brightest.x, y: brightest.y };
  const center = settings.center ?? { x: brightest.x, y: brightest.y };
  if (Math.hypot(center.x - refBrightest.x, center.y - refBrightest.y) > 6) {
    warnings.push(
      'Вибраний центр далеко від найяскравішої зорі. Вирівнювання виконується по найяскравішій зорі, а контраст рахується навколо вибраного центра — переконайтеся, що це та сама ціль.',
    );
  }
  const starPeak = Math.max(
    1,
    (() => {
      let peak = -Infinity;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = Math.round(center.x) + dx;
          const y = Math.round(center.y) + dy;
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          const v = ref.data[y * width + x];
          if (Number.isFinite(v) && v > peak) peak = v;
        }
      }
      return peak - brightest.background;
    })(),
  );

  input.onProgress?.(0.06, 'Вирівнювання кадрів');
  const aligned: Float32Array[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const star = findBrightestCentroid(frame);
    const dx = star.x - refBrightest.x;
    const dy = star.y - refBrightest.y;
    aligned.push(shiftImage(frame.data, width, height, -dx, -dy));
    if (i % 4 === 0) {
      input.onProgress?.(0.06 + (0.3 * i) / frames.length, `Вирівнювання ${i + 1}/${frames.length}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  input.onProgress?.(0.37, 'Медіанний PSF-референс');
  const reference = medianStack(aligned, width, height);

  const angles: number[] = frames.map((frame, index) => {
    if (settings.angleMode === 'header') {
      const angle = frame.meta.parang;
      return Number.isFinite(angle) ? angle! : 0;
    }
    if (settings.angleMode === 'manual') {
      return settings.manualStart + index * settings.manualStep;
    }
    return 0;
  });
  const totalRotation =
    settings.angleMode === 'none'
      ? 0
      : Math.max(...angles) - Math.min(...angles);
  if (settings.angleMode === 'header' && totalRotation < 1) {
    warnings.push(
      'PARANG у заголовках відсутній або нульовий — ADI вироджується в RDI. Планета може самовіднятися разом із PSF.',
    );
  } else if (settings.angleMode !== 'none' && totalRotation < 8) {
    warnings.push(
      `Загальне обертання поля лише ${totalRotation.toFixed(1)}° — для ADI бажано > 10°, інакше слабкі джерела губляться.`,
    );
  }
  if (settings.angleMode === 'none') {
    warnings.push('Режим без обертання: виконано RDI (медіанний референс). ADI-переваги недоступні.');
  }

  input.onProgress?.(0.42, 'Віднімання PSF та обертання');
  const residuals: Float32Array[] = [];
  for (let i = 0; i < aligned.length; i++) {
    const frame = aligned[i];
    const residual = new Float32Array(width * height);
    for (let p = 0; p < residual.length; p++) {
      const value = frame[p] - reference[p];
      residual[p] = Number.isFinite(value) ? value : NaN;
    }
    const angle = (angles[i] * Math.PI) / 180;
    residuals.push(angle === 0 ? residual : rotateImage(residual, width, height, center.x, center.y, angle));
    if (i % 3 === 0) {
      input.onProgress?.(0.42 + (0.36 * i) / aligned.length, `ADI: кадр ${i + 1}/${aligned.length}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const combined = meanStack(residuals, width, height);
  input.onProgress?.(0.82, 'Карта шуму та контрастність');
  const minSep = Math.max(3, settings.minSeparation);
  const maxSep = Math.min(settings.maxSeparation, Math.min(width, height) / 2 - 3);
  if (!(maxSep > minSep + 2)) {
    throw new Error('Діапазон радіусів для контрастної кривої порожній. Зменште мінімальну відстань.');
  }
  const bins = radialNoise(combined, width, height, center.x, center.y, minSep, maxSep, 2);
  const snrMap = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x - center.x, y - center.y);
      if (r < minSep || r > maxSep) {
        snrMap[y * width + x] = 0;
        continue;
      }
      const sigma = interpolateSigma(bins, r);
      const value = combined[y * width + x];
      snrMap[y * width + x] = Number.isFinite(value) && sigma > 0 ? value / sigma : 0;
    }
  }
  const contrastCurve: ContrastPoint[] = bins.map((bin) => {
    const contrast1 = bin.sigma / Math.max(starPeak, 1e-12);
    const contrast5 = (5 * bin.sigma) / Math.max(starPeak, 1e-12);
    return {
      sepPx: bin.r,
      sepArcsec: bin.r * input.pixelScale,
      sigma: bin.sigma,
      contrast1,
      contrast5,
      contrast5Mag: -2.5 * Math.log10(Math.max(contrast5, 1e-12)),
    };
  });
  const candidates = findCandidates(
    combined,
    snrMap,
    width,
    height,
    center.x,
    center.y,
    minSep,
    maxSep,
    settings.threshold,
    starPeak,
    bins,
    input.pixelScale,
  );
  if (!candidates.length) {
    warnings.push('Кандидатів вище порогу не знайдено. Можна знизити поріг або перевірити кути/центр.');
  }
  input.onProgress?.(0.97, 'Готово');
  return {
    reference,
    combined,
    snrMap,
    width,
    height,
    center,
    starPeak,
    contrastCurve,
    candidates,
    framesUsed: frames.length,
    totalRotation,
    angleSource:
      settings.angleMode === 'header'
        ? 'PARANG із заголовків'
        : settings.angleMode === 'manual'
          ? 'вручну задані кути'
          : 'без обертання (RDI)',
    warnings,
    settings,
    elapsedMs: performance.now() - start,
  };
}

export function percentileStretch(data: Float32Array, low = 1, high = 99): { lo: number; hi: number } {
  return { lo: percentile(data, low), hi: percentile(data, high) };
}

export { clamp };
