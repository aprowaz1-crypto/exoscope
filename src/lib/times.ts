import type { Frame, FrameMeta } from '../types';
import { median } from './stats';

export const JD_UNIX_EPOCH = 2440587.5;
export const MJD_OFFSET = 2400000.5;

export function dateToJd(date: Date): number {
  return JD_UNIX_EPOCH + date.getTime() / 86400000;
}

export function jdToDate(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * 86400000);
}

export function parseDateToJd(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else {
    s = s.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? JD_UNIX_EPOCH + ms / 86400000 : null;
}

export interface HeaderLike {
  getValue: (key: string) => string | number | boolean | null | undefined;
  has: (key: string) => boolean;
}

export function extractFrameMeta(header: HeaderLike): FrameMeta {
  const num = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = header.getValue(key);
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Number(value.replace(/[dD]/, 'E'));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  };
  const str = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = header.getValue(key);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };

  const meta: FrameMeta = {};
  const jdKeys: Array<[string, FrameMeta['jdKind']]> = [
    ['BJD_TDB', 'BJD_TDB'],
    ['BJD-TDB', 'BJD_TDB'],
    ['BJD', 'BJD'],
    ['HJD', 'HJD'],
    ['JD', 'JD'],
    ['MJD-OBS', 'MJD'],
    ['MJD', 'MJD'],
  ];
  for (const [key, kind] of jdKeys) {
    const value = num([key]);
    if (value === undefined) continue;
    meta.jd = kind === 'MJD' ? value + MJD_OFFSET : value;
    meta.jdKind = kind;
    break;
  }
  const dateObs = str(['DATE-OBS', 'DATE_OBS', 'DATE', 'DATE-BEG']);
  if (dateObs) {
    meta.dateObs = dateObs;
    if (meta.jd === undefined) {
      const jd = parseDateToJd(dateObs);
      if (jd !== null) {
        meta.jd = jd;
        meta.jdKind = 'DATE-OBS';
      }
    }
  }
  const exposure = num(['EXPTIME', 'EXPOSURE', 'TELAPSE', 'ITIME']);
  if (exposure !== undefined) meta.exposure = exposure;
  const airmass = num(['AIRMASS', 'AIRMASS_START', 'AIRMASS-END', 'AIRMASS_END']);
  if (airmass !== undefined) meta.airmass = airmass;
  const parang = num(['PARANG', 'PARANGLE', 'ROTANGLE', 'ROTATOR', 'INSTRANG']);
  if (parang !== undefined) meta.parang = parang;
  const scale = num(['PIXSCALE', 'PIXSCALE1', 'SECPIX', 'SECPIX1', 'PXSCALE', 'SCALE']);
  const cdelt1 = num(['CDELT1']);
  const cdelt2 = num(['CDELT2']);
  if (scale !== undefined && scale > 0) meta.pixelScale = scale;
  else if (cdelt1 !== undefined && cdelt2 !== undefined) {
    meta.pixelScale = Math.abs(cdelt1) * 3600;
  }
  const gain = num(['GAIN', 'EGAIN', 'CCDGAIN']);
  if (gain !== undefined && gain > 0) meta.gain = gain;
  const rn = num(['READNOISE', 'RDNOISE', 'RN', 'ENOISE']);
  if (rn !== undefined && rn >= 0) meta.readNoise = rn;
  const saturate = num(['SATURATE', 'SATURATION', 'DATAMAX', 'FULLWELL']);
  if (saturate !== undefined) meta.saturate = saturate;
  meta.filter = str(['FILTER', 'FILTERS', 'BAND', 'INSTRUME.MODE']);
  meta.object = str(['OBJECT', 'OBJNAME', 'TARGNAME']);
  meta.telescope = str(['TELESCOP', 'OBSERVAT']);
  meta.instrument = str(['INSTRUME', 'INSTRUMENT']);
  return meta;
}

export interface TimeResolution {
  times: Float64Array;
  source: string;
  absolute: boolean;
  warnings: string[];
  label: string;
}

export interface FallbackTime {
  startJd: number;
  cadenceDays: number;
}

export function resolveTimes(frames: Frame[], fallback?: FallbackTime): TimeResolution {
  const times = new Float64Array(frames.length);
  const warnings: string[] = [];
  let fromHeader = 0;
  let fromDateObs = 0;
  let fromFallback = 0;
  const kinds = new Set<string>();
  for (let i = 0; i < frames.length; i++) {
    const meta = frames[i].meta;
    if (Number.isFinite(meta.jd)) {
      let jd = meta.jd!;
      // DATE-OBS is usually the start of the exposure; take the mid-exposure.
      if (meta.jdKind === 'DATE-OBS' && meta.exposure && meta.exposure > 0) {
        jd += meta.exposure / 2 / 86400;
      }
      times[i] = jd;
      kinds.add(meta.jdKind ?? 'JD');
      if (meta.jdKind === 'DATE-OBS') fromDateObs++;
      else fromHeader++;
    } else if (fallback) {
      times[i] = fallback.startJd + i * fallback.cadenceDays;
      fromFallback++;
    } else {
      times[i] = i;
      fromFallback++;
    }
  }
  const absolute =
    fromHeader + fromDateObs > 0 ||
    (fromFallback > 0 && Number.isFinite(times[0]) && times[0] > 2_000_000);
  let source = 'кадр';
  if (fromHeader > 0 && fromDateObs === 0 && fromFallback === 0) {
    source = [...kinds].join(', ');
  } else if (fromDateObs > 0 && fromHeader === 0 && fromFallback === 0) {
    source = 'DATE-OBS';
  } else if (fromHeader + fromDateObs > 0 && fromFallback > 0) {
    source = 'змішані джерела часу';
    warnings.push(
      'Частина кадрів не має часових заголовків — для них використано резервний час. Перевірте криву світла.',
    );
  } else {
    source = fallback ? (absolute ? 'заданий JD' : 'резервний час') : 'порядковий номер кадру';
    if (!fallback) {
      warnings.push('У заголовках немає часу. Задайте початковий JD і крок експозицій у налаштуваннях.');
    } else {
      warnings.push('Заголовки не містять часу: використано вказані вами початковий JD і крок.');
    }
  }
  if (fromDateObs > 0) {
    warnings.push(
      'Для DATE-OBS додано половину експозиції до середини кадру. Якщо у вас BJD_TDB/JD, перевага надається їм.',
    );
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1] - 1e-9) {
      warnings.push('Час кадрів не монотонний — кадри буде відсортовано за часом.');
      break;
    }
  }
  return { times, source, absolute, warnings, label: absolute ? 'JD' : 't' };
}

export function estimateCadenceDays(times: Float64Array): number {
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0 && Number.isFinite(d)) diffs.push(d);
  }
  return diffs.length ? median(diffs) : 0;
}

export function sortFramesByTime(frames: Frame[]): Frame[] {
  if (frames.some((f) => !Number.isFinite(f.meta.jd))) return frames;
  return [...frames].sort((a, b) => (a.meta.jd ?? 0) - (b.meta.jd ?? 0));
}

export function formatTime(jd: number, absolute: boolean): string {
  if (!Number.isFinite(jd)) return '—';
  if (!absolute) return jd.toFixed(3);
  return (jd - 2450000).toFixed(5);
}
