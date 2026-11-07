import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Frame } from '../types';
import { runAdi, rotateImage } from './adi';
import { gaussian, mulberry32 } from './random';

function addGaussian(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  peak: number,
  sigma: number,
): void {
  const radius = Math.ceil(sigma * 4);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const r2 = (px - x) ** 2 + (py - y) ** 2;
      data[py * width + px] += peak * Math.exp(-r2 / (2 * sigma * sigma));
    }
  }
}

describe('image rotation and ADI', () => {
  it('rotates image content by the requested angle', () => {
    const size = 64;
    const data = new Float32Array(size * size);
    data[32 * size + 42] = 1;
    const rotated = rotateImage(data, size, size, 32, 32, Math.PI / 2);
    assert.ok(Math.abs(rotated[42 * size + 32] - 1) < 0.01);
  });

  it('recovers a synthetic companion with ADI', async () => {
    const width = 96;
    const height = 96;
    const cx = 48;
    const cy = 48;
    const n = 15;
    const planetR = 25;
    const skyAngle = 30;
    const rng = mulberry32(7);
    const frames: Frame[] = [];
    for (let i = 0; i < n; i++) {
      const parang = -15 + (30 * i) / (n - 1);
      const data = new Float32Array(width * height).fill(10);
      addGaussian(data, width, height, cx, cy, 5000, 1.6);
      const detectorAngle = ((skyAngle - parang) * Math.PI) / 180;
      addGaussian(
        data,
        width,
        height,
        cx + planetR * Math.cos(detectorAngle),
        cy + planetR * Math.sin(detectorAngle),
        45,
        1.6,
      );
      for (let p = 0; p < data.length; p++) data[p] += gaussian(rng) * 1.5;
      frames.push({
        id: `adi-${i}`,
        name: `adi-${i}.fits`,
        width,
        height,
        data,
        header: {},
        meta: { parang, pixelScale: 0.1, gain: 1, readNoise: 2 },
      });
    }
    const result = await runAdi({
      frames,
      settings: {
        center: { x: cx, y: cy },
        angleMode: 'header',
        manualStart: 0,
        manualStep: 0,
        minSeparation: 10,
        maxSeparation: 42,
        threshold: 4,
        pixelScale: 0.1,
        maxFrames: 20,
      },
      pixelScale: 0.1,
    });
    assert.equal(result.framesUsed, n);
    assert.ok(Math.abs(result.totalRotation - 30) < 1e-6);
    const expectedX = cx + planetR * Math.cos((skyAngle * Math.PI) / 180);
    const expectedY = cy + planetR * Math.sin((skyAngle * Math.PI) / 180);
    const best = result.candidates
      .map((c) => ({ ...c, d: Math.hypot(c.x - expectedX, c.y - expectedY) }))
      .sort((a, b) => a.d - b.d)[0];
    assert.ok(best);
    assert.ok(best.d < 4);
    assert.ok(best.snr > 4);
    assert.ok(result.contrastCurve.length > 3);
  });
});
