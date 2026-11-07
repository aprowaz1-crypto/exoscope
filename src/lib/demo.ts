import type { Dataset, Frame, FrameMeta } from '../types';
import { gaussian, mulberry32, randRange, type Rng } from './random';
import { transitModelAt } from './transit';
import { jdToDate } from './times';

const TICK = () => new Promise((resolve) => setTimeout(resolve, 0));

function addGaussian(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  peak: number,
  sigma: number,
): void {
  if (!(peak > 0) || !(sigma > 0)) return;
  const radius = Math.ceil(sigma * 4.2);
  const ix = Math.round(x);
  const iy = Math.round(y);
  const norm = 1 / (2 * Math.PI * sigma * sigma);
  for (let dy = -radius; dy <= radius; dy++) {
    const py = iy + dy;
    if (py < 0 || py >= height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const px = ix + dx;
      if (px < 0 || px >= width) continue;
      const r2 = (px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2;
      if (r2 > (radius + 1) ** 2) continue;
      data[py * width + px] += peak * Math.exp(-r2 / (2 * sigma * sigma)) * norm * 2 * Math.PI * sigma * sigma;
    }
  }
}

function addNoise(
  data: Float32Array,
  sky: number,
  gain: number,
  readNoise: number,
  rng: Rng,
): void {
  for (let i = 0; i < data.length; i++) {
    const signal = Math.max(0, data[i] - sky);
    const sigma = Math.sqrt((sky + 0.35 * signal) / gain + readNoise * readNoise);
    data[i] += gaussian(rng) * sigma;
  }
}

function makeHeader(meta: FrameMeta): Frame['header'] {
  const header: Frame['header'] = {};
  if (meta.object) header.OBJECT = { value: meta.object, comment: 'target name' };
  if (meta.exposure !== undefined) header.EXPTIME = { value: meta.exposure, comment: 'seconds' };
  if (meta.gain !== undefined) header.GAIN = { value: meta.gain, comment: 'e-/ADU' };
  if (meta.readNoise !== undefined) header.READNOISE = { value: meta.readNoise, comment: 'electrons' };
  if (meta.pixelScale !== undefined) header.PIXSCALE = { value: meta.pixelScale, comment: 'arcsec/pixel' };
  if (meta.saturate !== undefined) header.SATURATE = { value: meta.saturate, comment: 'ADU' };
  if (meta.parang !== undefined) header.PARANG = { value: meta.parang, comment: 'degrees' };
  if (meta.jd !== undefined) header.JD = { value: meta.jd, comment: 'Julian Date' };
  return header;
}

interface DemoStar {
  x: number;
  y: number;
  peak: number;
  fwhm: number;
  variable: boolean;
  phase: number;
}

export interface DemoOptions {
  onProgress?: (value: number, label: string) => void;
}

export async function generateTransitDemo(options: DemoOptions = {}): Promise<Dataset> {
  const rng = mulberry32(20261107);
  const width = 176;
  const height = 176;
  const nFrames = 260;
  const cadence = 0.0125; // 18 minutes
  const tStart = 2461000.5;
  const period = 1.13;
  const depth = 0.012;
  const duration = 0.075;
  const ingress = 0.011;
  const t0 = tStart + 0.45;
  const sky = 120;
  const gain = 1.5;
  const readNoise = 8;
  const cx = width / 2;
  const cy = height / 2;
  const stars: DemoStar[] = [
    { x: cx, y: cy, peak: 42_000, fwhm: 2.75, variable: false, phase: 0 },
  ];
  let attempts = 0;
  while (stars.length < 48 && attempts < 5000) {
    attempts++;
    const x = randRange(rng, 10, width - 10);
    const y = randRange(rng, 10, height - 10);
    if (Math.hypot(x - cx, y - cy) < 12) continue;
    if (stars.some((s) => Math.hypot(s.x - x, s.y - y) < 9)) continue;
    const faint = rng() < 0.35;
    const peak = faint
      ? Math.exp(randRange(rng, Math.log(900), Math.log(4500)))
      : Math.exp(randRange(rng, Math.log(5000), Math.log(55_000)));
    stars.push({
      x,
      y,
      peak,
      fwhm: randRange(rng, 2.35, 3.15),
      variable: stars.length === 7,
      phase: randRange(rng, 0, Math.PI * 2),
    });
  }
  const frames: Frame[] = [];
  const seeingPhase = randRange(rng, 0, 10);
  for (let i = 0; i < nFrames; i++) {
    const time = tStart + i * cadence;
    const jitterX = gaussian(rng) * 0.32;
    const jitterY = gaussian(rng) * 0.32;
    const transparency =
      1 +
      0.0032 * Math.sin((i / 29) * Math.PI * 2 + 1.7) +
      0.0011 * gaussian(rng);
    const fwhmFactor = 1 + 0.035 * Math.sin((i / 23) * Math.PI * 2 + seeingPhase) + 0.012 * gaussian(rng);
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data[y * width + x] = sky + 0.11 * x + 0.07 * y;
      }
    }
    const transit = transitModelAt(time, { period, t0, depth, duration, ingress });
    for (const star of stars) {
      let amplitude = star.peak;
      if (star.variable) amplitude *= 1 + 0.018 * Math.sin((time - tStart) * 2 * Math.PI / 0.53 + star.phase);
      if (Math.abs(star.x - cx) < 1e-6 && Math.abs(star.y - cy) < 1e-6) amplitude *= transit;
      amplitude *= transparency;
      const sigma = (star.fwhm * fwhmFactor) / 2.3548;
      addGaussian(data, width, height, star.x + jitterX, star.y + jitterY, amplitude, sigma);
    }
    addNoise(data, sky + 0.09 * (width / 2), gain, readNoise, rng);
    const meta: FrameMeta = {
      jd: time,
      jdKind: 'JD',
      dateObs: jdToDate(time).toISOString(),
      exposure: 300,
      filter: 'R',
      airmass: 1.02 + 0.12 * Math.sin((i / nFrames) * Math.PI),
      pixelScale: 1.3,
      gain,
      readNoise,
      saturate: 65535,
      object: 'ExoScope transit demo',
      telescope: 'Synthetic 0.4 m',
      instrument: 'DemoCam',
    };
    frames.push({
      id: `demo-transit-${i}`,
      name: `demo_transit_${String(i + 1).padStart(3, '0')}.fits`,
      width,
      height,
      data,
      header: makeHeader(meta),
      meta,
    });
    if (i % 20 === 0) {
      options.onProgress?.(i / nFrames, `Генерація демо: ${i + 1}/${nFrames}`);
      await TICK();
    }
  }
  options.onProgress?.(1, 'Демо готове');
  return {
    id: `demo-transit-${Date.now()}`,
    name: 'Демо: транзит гарячого юпітера',
    kind: 'transit',
    frames,
    pixelScale: 1.3,
    demo: 'transit',
    targetHint: { x: cx, y: cy },
    notes:
      'Синтетичні 260 кадрів 176×176, 18 хв крок, 3 транзити. Параметри: P=1.13 d, глибина 12 000 ppm, T14=1.8 год. Є змінна зоря порівняння та зміна прозорості.',
  };
}

export async function generateImagingDemo(options: DemoOptions = {}): Promise<Dataset> {
  const rng = mulberry32(771337);
  const width = 256;
  const height = 256;
  const nFrames = 28;
  const cx = width / 2;
  const cy = height / 2;
  const starPeak = 60_000;
  const planetContrast = 4e-4;
  const planetSeparation = 34;
  const planetSkyAngle = 64;
  const sky = 80;
  const gain = 1.6;
  const readNoise = 5;
  const staticSpeckles: Array<{ r: number; angle: number; peak: number; sigma: number }> = [];
  for (let i = 0; i < 34; i++) {
    staticSpeckles.push({
      r: randRange(rng, 8, 112),
      angle: randRange(rng, 0, Math.PI * 2),
      peak: starPeak * Math.exp(randRange(rng, Math.log(4e-6), Math.log(2.4e-4))),
      sigma: randRange(rng, 1.1, 2.6),
    });
  }
  const frames: Frame[] = [];
  for (let i = 0; i < nFrames; i++) {
    const parang = (i - (nFrames - 1) / 2) * 1.55;
    const jitterX = gaussian(rng) * 0.28;
    const jitterY = gaussian(rng) * 0.28;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        data[y * width + x] = sky + 0.035 * x + 0.025 * y;
      }
    }
    const starSigma = 2.05;
    addGaussian(data, width, height, cx + jitterX, cy + jitterY, starPeak, starSigma);
    // Static, pupil-fixed speckle halo.
    for (const speckle of staticSpeckles) {
      const x = cx + speckle.r * Math.cos(speckle.angle) + jitterX;
      const y = cy + speckle.r * Math.sin(speckle.angle) + jitterY;
      addGaussian(data, width, height, x, y, speckle.peak, speckle.sigma);
    }
    // Breathing/time-varying speckles.
    for (let s = 0; s < 7; s++) {
      const r = randRange(rng, 10, 112);
      const angle = randRange(rng, 0, Math.PI * 2);
      const peak = starPeak * randRange(rng, 8e-6, 5.5e-5);
      addGaussian(
        data,
        width,
        height,
        cx + r * Math.cos(angle) + jitterX,
        cy + r * Math.sin(angle) + jitterY,
        peak,
        randRange(rng, 1.2, 2.8),
      );
    }
    // The planet rotates with the field (pupil-stabilised convention).
    const angleRad = (planetSkyAngle * Math.PI) / 180 - (parang * Math.PI) / 180;
    const px = cx + planetSeparation * Math.cos(angleRad) + jitterX;
    const py = cy + planetSeparation * Math.sin(angleRad) + jitterY;
    addGaussian(data, width, height, px, py, starPeak * planetContrast, 2.0);
    addNoise(data, sky + 0.03 * (width / 2), gain, readNoise, rng);
    const meta: FrameMeta = {
      parang,
      pixelScale: 0.05,
      exposure: 20,
      filter: 'H',
      gain,
      readNoise,
      saturate: 65535,
      object: 'ExoScope imaging demo',
      telescope: 'Synthetic 8 m',
      instrument: 'DemoIFS',
    };
    frames.push({
      id: `demo-imaging-${i}`,
      name: `demo_adi_${String(i + 1).padStart(2, '0')}.fits`,
      width,
      height,
      data,
      header: makeHeader(meta),
      meta,
    });
    if (i % 4 === 0) {
      options.onProgress?.(i / nFrames, `Генерація ADI-демо: ${i + 1}/${nFrames}`);
      await TICK();
    }
  }
  options.onProgress?.(1, 'Демо готове');
  return {
    id: `demo-imaging-${Date.now()}`,
    name: 'Демо: пряме зображення з ADI',
    kind: 'imaging',
    frames,
    pixelScale: 0.05,
    demo: 'imaging',
    centerHint: { x: cx, y: cy },
    notes:
      'Синтетичні 28 кадрів 256×256, обертання поля ≈ 42°. Планета: 34 px = 1.7″, контраст 4×10⁻⁴ (≈ 8.5 mag), позиційний кут 64°.',
  };
}
