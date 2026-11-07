import type { FrameTransform, Star } from '../types';

export const IDENTITY_TRANSFORM: FrameTransform = {
  a: 1,
  b: 0,
  tx: 0,
  ty: 0,
  rms: 0,
  matched: 0,
  valid: true,
};

export function applyTransform(t: FrameTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: t.a * x - t.b * y + t.tx,
    y: t.b * x + t.a * y + t.ty,
  };
}

interface Pair {
  rx: number;
  ry: number;
  mx: number;
  my: number;
}

function fitSimilarity(pairs: Pair[]): Omit<FrameTransform, 'rms' | 'matched' | 'valid'> | null {
  if (pairs.length < 3) return null;
  let mrx = 0;
  let mry = 0;
  let mmx = 0;
  let mmy = 0;
  for (const p of pairs) {
    mrx += p.rx;
    mry += p.ry;
    mmx += p.mx;
    mmy += p.my;
  }
  const n = pairs.length;
  mrx /= n;
  mry /= n;
  mmx /= n;
  mmy /= n;
  let den = 0;
  let numA = 0;
  let numB = 0;
  for (const p of pairs) {
    const rx = p.rx - mrx;
    const ry = p.ry - mry;
    const mx = p.mx - mmx;
    const my = p.my - mmy;
    den += rx * rx + ry * ry;
    numA += rx * mx + ry * my;
    numB += rx * my - ry * mx;
  }
  if (den < 1e-9) return null;
  const a = numA / den;
  const b = numB / den;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || scale < 0.85 || scale > 1.18) return null;
  const tx = mmx - a * mrx + b * mry;
  const ty = mmy - b * mrx - a * mry;
  return { a, b, tx, ty };
}

function findMatches(
  refs: Star[],
  movers: Star[],
  transform: FrameTransform,
  tolerance: number,
): Pair[] {
  const pairs: Pair[] = [];
  const used = new Uint8Array(movers.length);
  const nm = Math.min(movers.length, 120);
  for (let i = 0; i < Math.min(refs.length, 100); i++) {
    const ref = refs[i];
    const predicted = applyTransform(transform, ref.x, ref.y);
    let best = -1;
    let bestD = tolerance;
    let secondD = Infinity;
    for (let j = 0; j < nm; j++) {
      if (used[j]) continue;
      const dx = movers[j].x - predicted.x;
      const dy = movers[j].y - predicted.y;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        secondD = bestD;
        bestD = d;
        best = j;
      } else if (d < secondD) secondD = d;
    }
    if (best >= 0 && bestD < secondD * 0.75) {
      used[best] = 1;
      pairs.push({ rx: ref.x, ry: ref.y, mx: movers[best].x, my: movers[best].y });
    }
  }
  return pairs;
}

function residualRms(pairs: Pair[], t: FrameTransform): number {
  if (!pairs.length) return Infinity;
  let sum = 0;
  for (const p of pairs) {
    const q = applyTransform(t, p.rx, p.ry);
    sum += (q.x - p.mx) ** 2 + (q.y - p.my) ** 2;
  }
  return Math.sqrt(sum / pairs.length);
}

export function estimateTransform(
  refs: Star[],
  movers: Star[],
  fwhm: number,
): FrameTransform {
  if (refs.length < 3 || movers.length < 3) {
    return { ...IDENTITY_TRANSFORM, valid: false };
  }
  const nRef = Math.min(30, refs.length);
  const nMov = Math.min(60, movers.length);
  const bins = new Map<string, { count: number; sx: number; sy: number }>();
  const binSize = 2;
  for (let i = 0; i < nRef; i++) {
    for (let j = 0; j < nMov; j++) {
      const dx = movers[j].x - refs[i].x;
      const dy = movers[j].y - refs[i].y;
      const key = `${Math.round(dx / binSize)},${Math.round(dy / binSize)}`;
      const bin = bins.get(key);
      if (bin) {
        bin.count++;
        bin.sx += dx;
        bin.sy += dy;
      } else bins.set(key, { count: 1, sx: dx, sy: dy });
    }
  }
  let bestBin: { count: number; sx: number; sy: number } | null = null;
  for (const bin of bins.values()) {
    if (!bestBin || bin.count > bestBin.count) bestBin = bin;
  }
  const tolerance = Math.max(2.5, fwhm * 1.4);
  let transform: FrameTransform = {
    ...IDENTITY_TRANSFORM,
    tx: bestBin ? bestBin.sx / bestBin.count : 0,
    ty: bestBin ? bestBin.sy / bestBin.count : 0,
    valid: false,
  };
  let pairs = findMatches(refs, movers, transform, tolerance);
  let bestPairs = pairs;
  for (let iter = 0; iter < 4; iter++) {
    const fitted = fitSimilarity(pairs);
    if (!fitted) break;
    transform = { ...fitted, rms: 0, matched: pairs.length, valid: false };
    const matched = findMatches(refs, movers, transform, tolerance * 0.8);
    if (matched.length >= 3) bestPairs = matched;
    if (matched.length < 3) break;
    pairs = matched;
    const rms = residualRms(pairs, transform);
    if (rms < 0.35) break;
  }
  const fitted = fitSimilarity(bestPairs);
  if (fitted) {
    const candidate: FrameTransform = {
      ...fitted,
      rms: residualRms(bestPairs, { ...fitted, rms: 0, matched: 0, valid: false }),
      matched: bestPairs.length,
      valid: false,
    };
    candidate.valid = candidate.matched >= 4 && candidate.rms < Math.max(2.5, fwhm * 1.2);
    if (candidate.valid) return candidate;
  }
  // Fall back to the strongest translation peak when the field is sparse.
  if (bestBin && bestBin.count >= 3) {
    const translation: FrameTransform = {
      ...IDENTITY_TRANSFORM,
      tx: bestBin.sx / bestBin.count,
      ty: bestBin.sy / bestBin.count,
      matched: bestBin.count,
      rms: 0,
      valid: bestBin.count >= 4,
    };
    return translation;
  }
  return { ...IDENTITY_TRANSFORM, valid: false };
}

export function transformStars(stars: Star[], t: FrameTransform): Star[] {
  return stars.map((s) => {
    const p = applyTransform(t, s.x, s.y);
    return { ...s, x: p.x, y: p.y };
  });
}
