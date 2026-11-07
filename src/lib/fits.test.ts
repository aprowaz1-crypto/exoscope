import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFitsBuffer } from './fits';

const encoder = new TextEncoder();

function card(key: string, value?: string | number | boolean | null, comment = ''): string {
  let out = key.padEnd(8);
  if (value !== undefined) {
    let text: string;
    if (typeof value === 'string') text = `'${value}'`;
    else if (typeof value === 'boolean') text = value ? 'T' : 'F';
    else if (value === null) text = '';
    else text = String(value);
    out += '= ' + text.padEnd(20);
    if (comment) out += `/ ${comment}`;
  }
  return out.padEnd(80).slice(0, 80);
}

function header(cards: string[]): Uint8Array {
  const text = cards.join('') + card('END');
  const padded = text.padEnd(Math.ceil(text.length / 2880) * 2880, ' ');
  return encoder.encode(padded);
}

function fitFile(cards: string[], data: Uint8Array): ArrayBuffer {
  const h = header(cards);
  const dataPadded = new Uint8Array(Math.ceil(data.length / 2880) * 2880);
  dataPadded.set(data);
  const out = new Uint8Array(h.length + dataPadded.length);
  out.set(h);
  out.set(dataPadded, h.length);
  return out.buffer;
}

describe('FITS parser', () => {
  it('reads a 16-bit primary image with BSCALE/BZERO', () => {
    const width = 4;
    const height = 3;
    const raw = new Uint16Array(width * height);
    for (let i = 0; i < raw.length; i++) raw[i] = 1000 + i;
    const bytes = new Uint8Array(raw.length * 2);
    const view = new DataView(bytes.buffer);
    raw.forEach((v, i) => view.setUint16(i * 2, v, false));
    const buffer = fitFile(
      [
        card('SIMPLE', true, 'conforms'),
        card('BITPIX', 16),
        card('NAXIS', 2),
        card('NAXIS1', width),
        card('NAXIS2', height),
        card('BZERO', 32768),
        card('BSCALE', 1),
        card('DATE-OBS', '2026-01-02T03:04:05'),
        card('EXPTIME', 10),
      ],
      bytes,
    );
    const result = parseFitsBuffer(buffer, 'test.fits');
    assert.equal(result.frames.length, 1);
    const frame = result.frames[0];
    assert.equal(frame.width, 4);
    assert.equal(frame.height, 3);
    assert.ok(Math.abs(frame.data[0] - 33768) < 1e-3);
    assert.equal(frame.meta.exposure, 10);
    assert.equal(frame.meta.jdKind, 'DATE-OBS');
    assert.ok((frame.meta.jd ?? 0) > 2461000);
  });

  it('reads a float32 image', () => {
    const width = 2;
    const height = 2;
    const bytes = new Uint8Array(width * height * 4);
    const view = new DataView(bytes.buffer);
    [1.5, -2.25, 3.75, 4.0].forEach((v, i) => view.setFloat32(i * 4, v, false));
    const buffer = fitFile(
      [
        card('SIMPLE', true),
        card('BITPIX', -32),
        card('NAXIS', 2),
        card('NAXIS1', width),
        card('NAXIS2', height),
      ],
      bytes,
    );
    const frame = parseFitsBuffer(buffer, 'float.fits').frames[0];
    assert.deepEqual(Array.from(frame.data), [1.5, -2.25, 3.75, 4]);
  });

  it('expands a NAXIS=3 cube into frames', () => {
    const width = 2;
    const height = 2;
    const planes = 3;
    const bytes = new Uint8Array(width * height * planes * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < width * height * planes; i++) view.setInt16(i * 2, i + 1, false);
    const buffer = fitFile(
      [
        card('SIMPLE', true),
        card('BITPIX', 16),
        card('NAXIS', 3),
        card('NAXIS1', width),
        card('NAXIS2', height),
        card('NAXIS3', planes),
      ],
      bytes,
    );
    const result = parseFitsBuffer(buffer, 'cube.fits');
    assert.equal(result.frames.length, 3);
    assert.equal(result.frames[1].data[0], 5);
    assert.equal(result.frames[2].data[3], 12);
  });

  it('rejects files without image HDUs', () => {
    const buffer = fitFile(
      [card('SIMPLE', true), card('BITPIX', 8), card('NAXIS', 0)],
      new Uint8Array(),
    );
    assert.throws(() => parseFitsBuffer(buffer, 'empty.fits'));
  });
});
