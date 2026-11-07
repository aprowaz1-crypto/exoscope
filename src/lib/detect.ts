import type { DetectionResult, Frame, Star } from '../types';
import { clamp, madSigma, median } from './stats';

export interface DetectOptions {
  thresholdSigma?: number;
  minArea?: number;
  maxArea?: number;
  maxStars?: number;
  saturation?: number;
  border?: number;
}

interface TileStats {
  bg: Float64Array;
  noise: Float64Array;
  nx: number;
  ny: number;
  tile: number;
}

function computeTileStats(data: Float32Array, width: number, height: number): TileStats {
  const tile = clamp(Math.round(Math.min(width, height) / 8), 24, 96);
  const nx = Math.max(1, Math.ceil(width / tile));
  const ny = Math.max(1, Math.ceil(height / tile));
  const bg = new Float64Array(nx * ny);
  const noise = new Float64Array(nx * ny);
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x0 = tx * tile;
      const y0 = ty * tile;
      const x1 = Math.min(width, x0 + tile);
      const y1 = Math.min(height, y0 + tile);
      const values: number[] = [];
      const stride = (x1 - x0) * (y1 - y0) > 4000 ? 2 : 1;
      for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          const v = data[y * width + x];
          if (Number.isFinite(v)) values.push(v);
        }
      }
      const m = median(values);
      const s = values.length > 2 ? madSigma(values, m) : 0;
      bg[ty * nx + tx] = Number.isFinite(m) ? m : 0;
      noise[ty * nx + tx] = Number.isFinite(s) && s > 0 ? s : 1e-6;
    }
  }
  return { bg, noise, nx, ny, tile };
}

function interpolateTile(
  values: Float64Array,
  nx: number,
  ny: number,
  tile: number,
  x: number,
  y: number,
): number {
  if (nx === 1 && ny === 1) return values[0];
  const gx = clamp(x / tile - 0.5, 0, nx - 1);
  const gy = clamp(y / tile - 0.5, 0, ny - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const v00 = values[y0 * nx + x0];
  const v10 = values[y0 * nx + x1];
  const v01 = values[y1 * nx + x0];
  const v11 = values[y1 * nx + x1];
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

export function detectStars(frame: Frame, options: DetectOptions = {}): DetectionResult {
  const { data, width, height } = frame;
  const thresholdSigma = options.thresholdSigma ?? 5;
  const minArea = options.minArea ?? 3;
  const maxArea = options.maxArea ?? 12_000;
  const maxStars = options.maxStars ?? 250;
  const border = options.border ?? 3;
  const saturation =
    options.saturation ??
    (frame.meta.saturate !== undefined && Number.isFinite(frame.meta.saturate)
      ? frame.meta.saturate
      : Number.POSITIVE_INFINITY);

  if (width * height === 0) {
    return { stars: [], background: 0, noise: 0, medianFwhm: 0, threshold: 0 };
  }
  const tiles = computeTileStats(data, width, height);
  const background = median(tiles.bg);
  const noise = median(tiles.noise);
  const thresholdMap = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bg = interpolateTile(tiles.bg, tiles.nx, tiles.ny, tiles.tile, x, y);
      const sig = interpolateTile(tiles.noise, tiles.nx, tiles.ny, tiles.tile, x, y);
      thresholdMap[y * width + x] = bg + thresholdSigma * sig;
    }
  }

  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(Math.min(width * height, 1 << 20));
  const stars: Star[] = [];
  const globalNoise = Math.max(noise, 1e-6);

  const isSignal = (index: number): boolean => {
    const v = data[index];
    return Number.isFinite(v) && v > thresholdMap[index];
  };

  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const start = sy * width + sx;
      if (visited[start] || !isSignal(start)) continue;
      let top = 0;
      stack[top++] = start;
      visited[start] = 1;
      let count = 0;
      let sumFlux = 0;
      let sumW = 0;
      let sumX = 0;
      let sumY = 0;
      let peak = -Infinity;
      let peakX = sx;
      let peakY = sy;
      let touchesBorder = false;
      let saturated = false;
      let xmin = sx;
      let xmax = sx;
      let ymin = sy;
      let ymax = sy;
      let overflow = false;
      const pixels: number[] = [];
      while (top > 0) {
        const index = stack[--top];
        const x = index % width;
        const y = (index / width) | 0;
        const value = data[index];
        count++;
        if (count > maxArea) {
          overflow = true;
          break;
        }
        pixels.push(index);
        const w = Math.max(0, value - thresholdMap[index] + thresholdSigma * globalNoise * 0.25);
        sumFlux += value - (thresholdMap[index] - thresholdSigma * globalNoise);
        sumW += w;
        sumX += w * x;
        sumY += w * y;
        if (value > peak) {
          peak = value;
          peakX = x;
          peakY = y;
        }
        if (value >= saturation * 0.98) saturated = true;
        if (x < border || x >= width - border || y < border || y >= height - border) touchesBorder = true;
        xmin = Math.min(xmin, x);
        xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const ni = ny * width + nx;
            if (!visited[ni] && isSignal(ni)) {
              visited[ni] = 1;
              if (top >= stack.length) {
                overflow = true;
                break;
              }
              stack[top++] = ni;
            }
          }
          if (overflow) break;
        }
        if (overflow) break;
      }
      if (overflow) {
        for (const index of pixels) visited[index] = 1;
        continue;
      }
      if (touchesBorder || count < minArea) continue;
      const cx = sumW > 0 ? sumX / sumW : sx;
      const cy = sumW > 0 ? sumY / sumW : sy;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const index of pixels) {
        const x = index % width;
        const y = (index / width) | 0;
        const value = data[index];
        const w = Math.max(0, value - thresholdMap[index] + thresholdSigma * globalNoise * 0.25);
        sxx += w * (x - cx) ** 2;
        syy += w * (y - cy) ** 2;
        sxy += w * (x - cx) * (y - cy);
      }
      const norm = Math.max(sumW, 1e-9);
      sxx /= norm;
      syy /= norm;
      sxy /= norm;
      const trace = sxx + syy;
      const det = sxx * syy - sxy * sxy;
      const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
      const l1 = trace / 2 + disc;
      const l2 = trace / 2 - disc;
      const fwhm = 2.3548 * Math.sqrt(Math.max(0, (sxx + syy) / 2));
      const elongation = Math.sqrt(Math.max(l1, 1e-9) / Math.max(l2, 1e-9));
      if (!Number.isFinite(fwhm) || fwhm < 0.55 || fwhm > 40) continue;
      if (elongation > 4) continue;
      if (!(sumFlux > 0)) continue;
      const bloom = xmax - xmin + 1 > 3 * Math.max(2, fwhm * 2.5);
      if (bloom && elongation > 2.2) continue;
      stars.push({
        id: 0,
        x: cx,
        y: cy,
        flux: sumFlux,
        peak,
        fwhm,
        snr: (peak - (thresholdMap[peakY * width + peakX] - thresholdSigma * globalNoise)) / globalNoise,
        area: count,
        elongation,
        saturated,
      });
    }
  }

  stars.sort((a, b) => b.flux - a.flux);
  const limited = stars.slice(0, maxStars);
  limited.forEach((star, index) => (star.id = index + 1));
  const fwhms = limited.map((s) => s.fwhm).filter((v) => v > 0.5 && v < 30);
  return {
    stars: limited,
    background,
    noise: globalNoise,
    medianFwhm: fwhms.length ? median(fwhms) : 0,
    threshold: background + thresholdSigma * globalNoise,
  };
}
