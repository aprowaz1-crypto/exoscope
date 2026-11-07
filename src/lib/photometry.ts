import type {
  DetectionResult,
  Frame,
  FrameTransform,
  PhotometryResult,
  PhotometrySettings,
  Star,
  StarSeries,
} from '../types';
import { applyTransform, estimateTransform, IDENTITY_TRANSFORM } from './align';
import { detectStars } from './detect';
import { madSigma, median } from './stats';

const PHASES = [-0.5, -0.25, 0, 0.25, 0.5];
const SUB = 4;

export interface KernelPixel {
  dx: number;
  dy: number;
  weight: number;
}

export interface KernelPhase {
  ap: KernelPixel[];
  sky: Array<{ dx: number; dy: number }>;
  area: number;
  skyArea: number;
}

export interface ApertureKernelSet {
  phases: KernelPhase[];
  radius: number;
  inner: number;
  outer: number;
  maxOffset: number;
}

function phaseIndex(fraction: number): number {
  const idx = Math.round((fraction + 0.5) / 0.25);
  return Math.max(0, Math.min(4, idx));
}

export function makeApertureKernel(
  radius: number,
  inner: number,
  outer: number,
): ApertureKernelSet {
  const phases: KernelPhase[] = [];
  const maxOffset = Math.ceil(outer) + 1;
  for (const fy of PHASES) {
    for (const fx of PHASES) {
      const ap: KernelPixel[] = [];
      const sky: Array<{ dx: number; dy: number }> = [];
      let area = 0;
      let skyArea = 0;
      for (let dy = -maxOffset; dy <= maxOffset; dy++) {
        for (let dx = -maxOffset; dx <= maxOffset; dx++) {
          let apHits = 0;
          let annHits = 0;
          for (let sy = 0; sy < SUB; sy++) {
            for (let sx = 0; sx < SUB; sx++) {
              const px = dx - fx + (sx + 0.5) / SUB - 0.5;
              const py = dy - fy + (sy + 0.5) / SUB - 0.5;
              const r2 = px * px + py * py;
              if (r2 <= radius * radius) apHits++;
              if (r2 >= inner * inner && r2 <= outer * outer) annHits++;
            }
          }
          const w = apHits / (SUB * SUB);
          const wa = annHits / (SUB * SUB);
          if (w > 0) {
            ap.push({ dx, dy, weight: w });
            area += w;
          }
          if (wa >= 0.5) sky.push({ dx, dy });
          if (wa > 0) skyArea += wa;
        }
      }
      phases.push({ ap, sky, area, skyArea });
    }
  }
  return { phases, radius, inner, outer, maxOffset };
}

export interface ApertureMeasurement {
  flux: number;
  fluxErr: number;
  sky: number;
  skySigma: number;
  x: number;
  y: number;
  peak: number;
  saturated: boolean;
  flags: number;
  coverage: number;
}

export const PHOT_FLAG_BOUNDS = 1;
export const PHOT_FLAG_SATURATED = 2;
export const PHOT_FLAG_LOW_COVERAGE = 4;
export const PHOT_FLAG_BAD_SKY = 8;

function measureAt(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  kernel: ApertureKernelSet,
  gain: number,
  readNoise: number,
  saturation: number,
): ApertureMeasurement {
  const ix = Math.round(x);
  const iy = Math.round(y);
  const fx = x - ix;
  const fy = y - iy;
  const phase = kernel.phases[phaseIndex(fy) * 5 + phaseIndex(fx)];
  let apSum = 0;
  let apWeight = 0;
  let peak = -Infinity;
  let flags = 0;
  let saturated = false;
  let cxWeight = 0;
  let cyWeight = 0;
  let cxSum = 0;
  let cySum = 0;
  for (const pixel of phase.ap) {
    const px = ix + pixel.dx;
    const py = iy + pixel.dy;
    if (px < 0 || px >= width || py < 0 || py >= height) {
      flags |= PHOT_FLAG_BOUNDS;
      continue;
    }
    const value = data[py * width + px];
    if (!Number.isFinite(value)) {
      flags |= PHOT_FLAG_BOUNDS;
      continue;
    }
    apSum += value * pixel.weight;
    apWeight += pixel.weight;
    if (value > peak) peak = value;
    if (value >= saturation * 0.98) saturated = true;
  }
  const coverage = phase.area > 0 ? apWeight / phase.area : 0;
  if (coverage < 0.88) flags |= PHOT_FLAG_LOW_COVERAGE;
  const skyValues = new Float64Array(phase.sky.length);
  let nSky = 0;
  for (const pixel of phase.sky) {
    const px = ix + pixel.dx;
    const py = iy + pixel.dy;
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const value = data[py * width + px];
    if (Number.isFinite(value)) skyValues[nSky++] = value;
  }
  let sky = 0;
  let skySigma = 0;
  if (nSky >= 5) {
    sky = median(skyValues.subarray(0, nSky));
    skySigma = madSigma(skyValues.subarray(0, nSky), sky);
  } else {
    flags |= PHOT_FLAG_BAD_SKY;
    sky = phase.sky.length ? apSum / Math.max(apWeight, 1) : 0;
  }
  if (!Number.isFinite(skySigma) || skySigma <= 0) {
    skySigma = Math.max(1, Math.sqrt(Math.max(sky, 0) / Math.max(gain, 1)));
  }
  const area = apWeight > 0 ? apWeight : phase.area;
  const flux = apSum - sky * apWeight;
  const perPixelVar = Math.max(
    skySigma * skySigma,
    Math.max(sky, 0) / Math.max(gain, 1) + (readNoise / Math.max(gain, 1)) ** 2,
  );
  const variance =
    Math.max(flux, 0) / Math.max(gain, 1) +
    area * perPixelVar * (1 + area / Math.max(nSky, 1));
  const fluxErr = Math.sqrt(Math.max(variance, 0));
  // Sub-pixel centroid from the same aperture pixels.
  for (const pixel of phase.ap) {
    const px = ix + pixel.dx;
    const py = iy + pixel.dy;
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const value = data[py * width + px];
    const w = Math.max(0, value - sky) * pixel.weight;
    if (w > 0) {
      cxWeight += w;
      cyWeight += w;
      cxSum += w * px;
      cySum += w * py;
    }
  }
  const cx = cxWeight > 0 ? cxSum / cxWeight : x;
  const cy = cyWeight > 0 ? cySum / cyWeight : y;
  if (saturated) flags |= PHOT_FLAG_SATURATED;
  return {
    flux,
    fluxErr,
    sky,
    skySigma,
    x: cx,
    y: cy,
    peak,
    saturated,
    flags,
    coverage,
  };
}

export interface PhotometryRunInput {
  frames: Frame[];
  refIndex: number;
  detection: DetectionResult;
  settings: PhotometrySettings;
  times: Float64Array;
  timeSource: string;
  timesAreAbsolute: boolean;
}

export type ProgressFn = (value: number, label: string) => void;

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function quickStats(frame: Frame): { background: number; noise: number } {
  const { data } = frame;
  const values: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 80_000));
  for (let i = 0; i < data.length; i += stride) {
    if (Number.isFinite(data[i])) values.push(data[i]);
  }
  const background = median(values);
  const noise = madSigma(values, background);
  return {
    background: Number.isFinite(background) ? background : 0,
    noise: Number.isFinite(noise) && noise > 0 ? noise : 1e-6,
  };
}

export async function runPhotometry(
  input: PhotometryRunInput,
  onProgress?: ProgressFn,
): Promise<PhotometryResult> {
  const { frames, refIndex, detection, settings } = input;
  if (!frames.length) throw new Error('Немає кадрів для фотометрії.');
  const ref = frames[refIndex];
  for (const frame of frames) {
    if (frame.width !== ref.width || frame.height !== ref.height) {
      throw new Error(
        `Розміри кадрів відрізняються (${frame.name}: ${frame.width}×${frame.height}, референс: ${ref.width}×${ref.height}). Сумісність розмірів обовʼязкова.`,
      );
    }
  }
  if (!detection.stars.length) throw new Error('На референсному кадрі не знайдено зірок.');
  const refFwhm = detection.medianFwhm > 0 ? detection.medianFwhm : 2.5;
  const radius = Math.max(1.6, refFwhm * settings.apertureFactor);
  const inner = radius + Math.max(1, settings.annulusGap);
  const outer = inner + Math.max(2, settings.annulusWidth);
  if (outer * 2 > Math.min(ref.width, ref.height)) {
    throw new Error('Апертура та кільце неба не вміщуються в кадр. Зменште радіус апертури.');
  }
  const kernel = makeApertureKernel(radius, inner, outer);
  const gain = settings.gain > 0 ? settings.gain : 1;
  const readNoise = settings.readNoise >= 0 ? settings.readNoise : 0;
  const saturation =
    Number.isFinite(ref.meta.saturate) && ref.meta.saturate! > 0
      ? ref.meta.saturate!
      : Number.POSITIVE_INFINITY;

  const nFrames = frames.length;
  const nStars = detection.stars.length;
  const series: StarSeries[] = detection.stars.map((star) => ({
    starId: star.id,
    x: new Float64Array(nFrames).fill(NaN),
    y: new Float64Array(nFrames).fill(NaN),
    flux: new Float64Array(nFrames).fill(NaN),
    fluxErr: new Float64Array(nFrames).fill(NaN),
    sky: new Float64Array(nFrames).fill(NaN),
    fwhm: new Float64Array(nFrames).fill(refFwhm),
    flags: new Uint8Array(nFrames),
  }));
  const transforms: FrameTransform[] = new Array(nFrames);
  const frameBackground = new Float64Array(nFrames);
  const frameNoise = new Float64Array(nFrames);
  const frameFwhm = new Float64Array(nFrames);
  const frameAirmass = new Float64Array(nFrames);
  const warnings: string[] = [];
  let invalidTransforms = 0;
  let sparseFrames = 0;

  for (let i = 0; i < nFrames; i++) {
    const frame = frames[i];
    let transform: FrameTransform = IDENTITY_TRANSFORM;
    let fwhm = refFwhm;
    let bg = 0;
    let noise = 0;
    if (i === refIndex) {
      bg = detection.background;
      noise = detection.noise;
      transform = { ...IDENTITY_TRANSFORM, matched: detection.stars.length, valid: true };
    } else if (settings.autoAlign) {
      const moving = detectStars(frame, {
        thresholdSigma: Math.max(4, settings.thresholdSigma - 1),
        maxStars: Math.min(120, Math.max(30, nStars)),
        saturation,
      });
      if (moving.stars.length >= 3) {
        transform = estimateTransform(detection.stars, moving.stars, refFwhm);
        fwhm = moving.medianFwhm || refFwhm;
      } else {
        sparseFrames++;
        transform = { ...IDENTITY_TRANSFORM, valid: false };
      }
      bg = moving.background;
      noise = moving.noise;
    } else {
      const stats = quickStats(frame);
      bg = stats.background;
      noise = stats.noise;
    }
    if (!transform.valid) invalidTransforms++;
    transforms[i] = transform;
    frameBackground[i] = bg;
    frameNoise[i] = noise;
    frameFwhm[i] = fwhm;
    frameAirmass[i] = Number.isFinite(frame.meta.airmass) ? frame.meta.airmass! : NaN;
    for (let s = 0; s < nStars; s++) {
      const star = detection.stars[s];
      const p = applyTransform(transform, star.x, star.y);
      if (p.x < -2 || p.y < -2 || p.x > ref.width + 2 || p.y > ref.height + 2) continue;
      const measurement = measureAt(
        frame.data,
        frame.width,
        frame.height,
        p.x,
        p.y,
        kernel,
        gain,
        readNoise,
        saturation,
      );
      const target = series[s];
      target.x[i] = measurement.x;
      target.y[i] = measurement.y;
      target.flux[i] = measurement.flux;
      target.fluxErr[i] = measurement.fluxErr;
      target.sky[i] = measurement.sky;
      target.fwhm[i] = fwhm;
      target.flags[i] = measurement.flags;
    }
    if (i % 3 === 0 || i === nFrames - 1) {
      onProgress?.((i + 1) / nFrames, `Фотометрія: кадр ${i + 1}/${nFrames}`);
      await yieldToBrowser();
    }
  }

  if (invalidTransforms > 0) {
    warnings.push(
      `${invalidTransforms} кадр(ів) не вдалося надійно вирівняти — для них використано зсув 0. Перевірте, чи зорі не «розмазані» у кривій світла.`,
    );
  }
  if (sparseFrames > 0) {
    warnings.push(`На ${sparseFrames} кадр(ах) знайдено менше 3 зірок для вирівнювання.`);
  }
  if (!Number.isFinite(ref.meta.gain) || !Number.isFinite(ref.meta.readNoise)) {
    warnings.push(
      'У заголовках немає GAIN/READNOISE — використано значення з налаштувань. Похибки фотометрії можуть бути неточними.',
    );
  }
  const fwhms = frameFwhm.filter((v) => Number.isFinite(v) && v > 0);
  if (fwhms.length && median(fwhms) > 8) {
    warnings.push('Середній FWHM > 8 px: зорі сильно розфокусовані або кадр поза фокусом.');
  }
  const timeSpanDays =
    nFrames > 1 && Number.isFinite(input.times[nFrames - 1]) && Number.isFinite(input.times[0])
      ? input.times[nFrames - 1] - input.times[0]
      : 0;
  return {
    stars: detection.stars,
    refIndex,
    series,
    times: input.times,
    timeSource: input.timeSource,
    timesAreAbsolute: input.timesAreAbsolute,
    transforms,
    frameBackground,
    frameNoise,
    frameFwhm,
    frameAirmass,
    settings,
    warnings,
    aperturePx: radius,
    timeSpanDays,
  };
}

export function starAt(phot: PhotometryResult, index: number): Star {
  return phot.stars[index];
}
