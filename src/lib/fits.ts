import type { FitsCard, Frame } from '../types';
import { extractFrameMeta } from './times';
import { clamp } from './stats';

const IS_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02;

let frameCounter = 0;

function newId(prefix: string): string {
  frameCounter++;
  return `${prefix}-${Date.now().toString(36)}-${frameCounter}`;
}

function padTo2880(bytes: number): number {
  return Math.ceil(bytes / 2880) * 2880;
}

function decodeCard(bytes: Uint8Array, start: number): string {
  return new TextDecoder('ascii').decode(bytes.subarray(start, start + 80));
}

function parseCardValue(card: string): { value: FitsCard['value']; comment: string } {
  let raw = card.slice(10);
  let comment = '';
  let value: FitsCard['value'] = null;
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("'")) {
    const offset = raw.length - trimmed.length;
    let i = offset + 1;
    let str = '';
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === "'") {
        if (raw[i + 1] === "'") {
          str += "'";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      str += ch;
      i++;
    }
    value = str.trimEnd();
    const rest = raw.slice(i);
    const slash = rest.indexOf('/');
    if (slash >= 0) comment = rest.slice(slash + 1).trim();
  } else {
    const slash = raw.indexOf('/');
    const valuePart = (slash >= 0 ? raw.slice(0, slash) : raw).trim();
    comment = slash >= 0 ? raw.slice(slash + 1).trim() : '';
    if (valuePart === '') value = null;
    else if (valuePart === 'T') value = true;
    else if (valuePart === 'F') value = false;
    else if (/^[+-]?(\d+\.?\d*|\.\d+)([EeDd][+-]?\d+)?$/.test(valuePart)) {
      value = Number(valuePart.replace(/[dD]/, 'E'));
    } else value = valuePart;
  }
  return { value, comment };
}

export interface ParsedHeader {
  cards: Record<string, FitsCard>;
  headerBytes: number;
  endFound: boolean;
}

export function parseHeader(bytes: Uint8Array, start: number): ParsedHeader {
  const cards: Record<string, FitsCard> = {};
  let offset = start;
  let endFound = false;
  while (offset + 80 <= bytes.length) {
    const card = decodeCard(bytes, offset);
    offset += 80;
    const key = card.slice(0, 8).trim().toUpperCase();
    if (key === 'END') {
      endFound = true;
      break;
    }
    if (!key) continue;
    if (key === 'COMMENT' || key === 'HISTORY' || key === 'CONTINUE' || key === 'HIERARCH') {
      continue;
    }
    if (card[8] !== '=') continue;
    cards[key] = parseCardValue(card);
  }
  return { cards, headerBytes: offset - start, endFound };
}

function numericCard(cards: Record<string, FitsCard>, key: string, fallback?: number): number {
  const value = cards[key]?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`FITS: відсутній обов'язковий заголовок ${key}`);
}

function hasImageData(cards: Record<string, FitsCard>): boolean {
  const naxis = numericCard(cards, 'NAXIS', 0);
  const bitpix = cards.BITPIX?.value;
  if (naxis < 2 || typeof bitpix !== 'number') return false;
  const xtension = String(cards.XTENSION?.value ?? 'IMAGE').toUpperCase();
  return xtension === 'IMAGE' || xtension === '';
}

function readImagePlane(
  buffer: ArrayBuffer,
  byteOffset: number,
  count: number,
  bitpix: number,
  bscale: number,
  bzero: number,
): Float32Array {
  const out = new Float32Array(count);
  const droppingOffset = Math.abs(bzero) > 1e6;
  const level = droppingOffset ? bzero : 0;
  if (bitpix === 8) {
    const src = new Uint8Array(buffer, byteOffset, count);
    for (let i = 0; i < count; i++) out[i] = bscale * src[i] + bzero - level;
    return out;
  }
  if (bitpix === 16) {
    const u16 = new Uint16Array(buffer, byteOffset, count);
    if (IS_LITTLE_ENDIAN) {
      for (let i = 0; i < count; i++) {
        const v = u16[i];
        u16[i] = ((v & 0xff) << 8) | (v >>> 8);
      }
    }
    const src = new Int16Array(buffer, byteOffset, count);
    for (let i = 0; i < count; i++) out[i] = bscale * src[i] + bzero - level;
    return out;
  }
  if (bitpix === 32) {
    const u32 = new Uint32Array(buffer, byteOffset, count);
    if (IS_LITTLE_ENDIAN) {
      for (let i = 0; i < count; i++) {
        const v = u32[i];
        u32[i] = ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24);
      }
    }
    const src = new Int32Array(buffer, byteOffset, count);
    for (let i = 0; i < count; i++) out[i] = bscale * src[i] + bzero - level;
    return out;
  }
  if (bitpix === -32) {
    const u32 = new Uint32Array(buffer, byteOffset, count);
    if (IS_LITTLE_ENDIAN) {
      for (let i = 0; i < count; i++) {
        const v = u32[i];
        u32[i] = ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24);
      }
    }
    const src = new Float32Array(buffer, byteOffset, count);
    for (let i = 0; i < count; i++) {
      const v = bscale * src[i] + bzero;
      out[i] = droppingOffset ? v - level : v;
    }
    return out;
  }
  if (bitpix === -64) {
    const view = new DataView(buffer);
    for (let i = 0; i < count; i++) {
      const v = bscale * view.getFloat64(byteOffset + i * 8, false) + bzero;
      out[i] = droppingOffset ? v - level : v;
    }
    return out;
  }
  throw new Error(`FITS: непідтримуваний BITPIX=${bitpix}`);
}

function binPlane(
  data: Float32Array,
  width: number,
  height: number,
  factor: number,
): { data: Float32Array; width: number; height: number } {
  if (factor <= 1) return { data, width, height };
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Float32Array(w * h);
  const norm = 1 / (factor * factor);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < factor; yy++) {
        const row = (y * factor + yy) * width + x * factor;
        for (let xx = 0; xx < factor; xx++) sum += data[row + xx];
      }
      out[y * w + x] = sum * norm;
    }
  }
  return { data: out, width: w, height: h };
}

export interface FitsLoadOptions {
  maxDim?: number;
  maxPlanes?: number;
  maxTotalPixels?: number;
}

export interface FitsLoadResult {
  frames: Frame[];
  warnings: string[];
  hduCount: number;
}

export function parseFitsBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options: FitsLoadOptions = {},
): FitsLoadResult {
  const bytes = new Uint8Array(buffer);
  const maxDim = options.maxDim ?? 1536;
  const maxPlanes = options.maxPlanes ?? 600;
  const maxTotalPixels = options.maxTotalPixels ?? 60_000_000;
  const frames: Frame[] = [];
  const warnings: string[] = [];
  let offset = 0;
  let hduIndex = 0;
  let hduCount = 0;

  while (offset + 80 <= bytes.length) {
    const headerStart = offset;
    let parsed: ParsedHeader;
    try {
      parsed = parseHeader(bytes, offset);
    } catch {
      warnings.push(`HDU ${hduIndex}: не вдалося прочитати заголовок.`);
      break;
    }
    hduCount++;
    if (!parsed.endFound) {
      warnings.push(`HDU ${hduIndex}: заголовок без END — файл обірвано.`);
      break;
    }
    const headerSize = padTo2880(parsed.headerBytes);
    const dataStart = headerStart + headerSize;
    const cards = parsed.cards;
    const naxis = numericCard(cards, 'NAXIS', 0);
    const bitpix = numericCard(cards, 'BITPIX', 0);
    const gcount = numericCard(cards, 'GCOUNT', 1);
    const pcount = numericCard(cards, 'PCOUNT', 0);
    let product = naxis > 0 ? 1 : 0;
    for (let axis = 1; axis <= naxis; axis++) {
      product *= numericCard(cards, `NAXIS${axis}`, 0);
    }
    const dataBytes = Math.abs(bitpix) / 8 * gcount * (pcount + product);
    const dataSize = padTo2880(dataBytes);

    if (hasImageData(cards) && dataStart + dataBytes <= bytes.length) {
      const width = numericCard(cards, 'NAXIS1');
      const height = numericCard(cards, 'NAXIS2');
      const naxis3 = naxis >= 3 ? numericCard(cards, 'NAXIS3', 1) : 1;
      let planes = Math.max(1, Math.round(naxis3));
      if (planes > maxPlanes) {
        warnings.push(
          `HDU ${hduIndex}: куб містить ${planes} площин, оброблено перші ${maxPlanes}.`,
        );
        planes = maxPlanes;
      }
      const perPlane = width * height;
      if (!Number.isFinite(perPlane) || perPlane <= 0) {
        warnings.push(`HDU ${hduIndex}: некоректні розміри зображення.`);
        offset = dataStart + dataSize;
        hduIndex++;
        continue;
      }
      let binFactor = 1;
      const largest = Math.max(width, height);
      if (largest > maxDim) binFactor = Math.ceil(largest / maxDim);
      if (binFactor > 8) {
        warnings.push(`HDU ${hduIndex}: зображення надто велике (${width}×${height}), бінінг ${binFactor}×.`);
        binFactor = clamp(binFactor, 1, 8);
      }
      const allowedPlanes = Math.max(1, Math.floor(maxTotalPixels / perPlane));
      if (planes > allowedPlanes) {
        warnings.push(
          `HDU ${hduIndex}: забагато пікселів для браузера — оброблено ${allowedPlanes} із ${planes} площин.`,
        );
        planes = allowedPlanes;
      }
      const bscale = numericCard(cards, 'BSCALE', 1);
      const bzero = numericCard(cards, 'BZERO', 0);
      const count = perPlane * planes;
      if (dataStart + count * Math.abs(bitpix) / 8 > bytes.length) {
        warnings.push(`HDU ${hduIndex}: дані обрізані — пропущено.`);
        offset = dataStart + dataSize;
        hduIndex++;
        continue;
      }
      let all: Float32Array;
      try {
        all = readImagePlane(buffer, dataStart, count, bitpix, bscale, bzero);
      } catch (error) {
        warnings.push(
          `HDU ${hduIndex}: ${error instanceof Error ? error.message : 'помилка читання даних'}.`,
        );
        offset = dataStart + dataSize;
        hduIndex++;
        continue;
      }
      const headerObject = cards;
      const meta = extractFrameMeta({
        getValue: (key) => cards[key]?.value,
        has: (key) => key in cards,
      });
      if (meta.pixelScale && binFactor > 1) meta.pixelScale *= binFactor;
      if (planes > 1 && meta.jdKind && meta.jdKind !== 'DATE-OBS') {
        warnings.push(
          `HDU ${hduIndex}: часовий заголовок ${meta.jdKind} застосовано до всіх площин куба. Задайте час вручну, якщо це sequence.`,
        );
      }
      for (let plane = 0; plane < planes; plane++) {
        let planeData = all.subarray(plane * perPlane, (plane + 1) * perPlane);
        let outW = width;
        let outH = height;
        if (binFactor > 1) {
          const binned = binPlane(planeData, width, height, binFactor);
          planeData = binned.data;
          outW = binned.width;
          outH = binned.height;
        }
        const suffix = planes > 1 ? ` [${plane + 1}/${planes}]` : hduCount > 1 ? ` [HDU ${hduIndex}]` : '';
        frames.push({
          id: newId('fits'),
          name: `${fileName}${suffix}`,
          width: outW,
          height: outH,
          data: planeData,
          header: headerObject,
          meta: { ...meta },
          binFactor,
        });
      }
    } else if (naxis > 0) {
      const xtension = String(cards.XTENSION?.value ?? '').toUpperCase();
      if (xtension === 'BINTABLE' || xtension === 'TABLE') {
        warnings.push(`HDU ${hduIndex}: таблиця ${xtension} пропущена (підтримуються лише зображення).`);
      }
    }
    offset = dataStart + dataSize;
    hduIndex++;
    if (dataSize === 0 && !hasImageData(cards) && naxis === 0 && hduIndex > 20) break;
  }

  if (frames.length === 0) {
    throw new Error(
      'У файлі не знайдено зображень FITS. Підтримуються IMAGE HDU з NAXIS≥2 (у т.ч. куби NAXIS=3).',
    );
  }
  return { frames, warnings, hduCount };
}
