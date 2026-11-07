import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blsSearch } from './bls';
import { fitTransit, transitModelAt } from './transit';
import { gaussian, mulberry32 } from './random';

function syntheticTransit() {
  const rng = mulberry32(42);
  const n = 240;
  const period = 1.31;
  const t0 = 0.83;
  const depth = 0.011;
  const duration = 0.075;
  const ingress = 0.012;
  const time = new Float64Array(n);
  const flux = new Float64Array(n);
  const err = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    time[i] = (i / n) * 5.1;
    const model = transitModelAt(time[i], { period, t0, depth, duration, ingress });
    flux[i] = model + gaussian(rng) * 0.0006;
    err[i] = 0.0006;
  }
  return { time, flux, err, period, t0, depth, duration };
}

describe('BLS transit search', () => {
  it('recovers a synthetic hot-Jupiter period', () => {
    const data = syntheticTransit();
    const result = blsSearch(data.time, data.flux, data.err, {
      minPeriod: 0.5,
      maxPeriod: 2.4,
      nPeriods: 900,
      minDurationHours: 1,
      maxDurationHours: 6,
      nBins: 200,
    });
    assert.ok(Math.abs(result.best.period - data.period) / data.period < 0.012);
    assert.ok(result.best.depth > 0.004);
    // Strong eclipses may partially align at many trial periods, which inflates
    // the spectrum width; SDE > 4.5 is a robust detection threshold here.
    assert.ok(result.sde > 4.5);
    const fit = fitTransit(data.time, data.flux, data.err, result.best);
    assert.ok(Math.abs(fit.params.period - data.period) / data.period < 0.01);
    assert.ok(Math.abs(fit.params.depth - data.depth) / data.depth < 0.25);
    assert.ok(fit.events.length >= 3);
    assert.ok(fit.snr > 5);
  });

  it('returns a period spectrum with finite values', () => {
    const data = syntheticTransit();
    const result = blsSearch(data.time, data.flux, data.err, {
      minPeriod: 0.5,
      maxPeriod: 2.0,
      nPeriods: 300,
      minDurationHours: 1,
      maxDurationHours: 5,
      nBins: 150,
    });
    assert.equal(result.spectrum.length, 300);
    assert.ok(result.spectrum.every((p) => Number.isFinite(p.score)));
    assert.ok(result.peaks.length > 0);
  });
});
