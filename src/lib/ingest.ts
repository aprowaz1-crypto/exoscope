import type { Dataset, Frame } from '../types';
import { parseFitsBuffer } from './fits';
import { median } from './stats';

const FITS_EXTENSIONS = /\.(fits?|fts)$/i;
const MAX_BYTES = 750 * 1024 * 1024;

let imageId = 0;

export interface IngestOptions {
  maxDim?: number;
  onProgress?: (value: number, label: string) => void;
}

export interface IngestResult {
  dataset: Dataset;
  warnings: string[];
}

async function imageFileToFrame(
  file: File,
  maxDim: number,
): Promise<{ frame: Frame; warning?: string }> {
  const bitmap = await createImageBitmap(file);
  const largest = Math.max(bitmap.width, bitmap.height);
  const scale = largest > maxDim ? maxDim / largest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Браузер не підтримує Canvas 2D.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    data[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  const baseName = file.name.replace(/\.[^.]+$/, '');
  imageId++;
  return {
    frame: {
      id: `img-${imageId}-${file.name}`,
      name: file.name,
      width,
      height,
      data,
      header: {},
      meta: { object: baseName },
      binFactor: scale,
    },
    warning:
      scale < 1
        ? `${file.name}: зменшено до ${width}×${height} px для браузера.`
        : undefined,
  };
}

export async function loadFiles(files: File[], options: IngestOptions = {}): Promise<IngestResult> {
  const maxDim = options.maxDim ?? 1536;
  const frames: Frame[] = [];
  const warnings: string[] = [];
  const total = files.length;
  let done = 0;
  for (const file of files) {
    options.onProgress?.(done / Math.max(1, total), `Читання ${file.name}`);
    const isFits =
      FITS_EXTENSIONS.test(file.name) ||
      (await file.slice(0, 6).text()).toUpperCase().startsWith('SIMPLE');
    if (isFits) {
      const buffer = await file.arrayBuffer();
      const parsed = parseFitsBuffer(buffer, file.name, { maxDim });
      frames.push(...parsed.frames);
      warnings.push(...parsed.warnings);
    } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(file.name)) {
      try {
        const { frame, warning } = await imageFileToFrame(file, maxDim);
        frames.push(frame);
        if (warning) warnings.push(warning);
      } catch (error) {
        warnings.push(
          `${file.name}: не вдалося прочитати зображення (${
            error instanceof Error ? error.message : 'невідома помилка'
          }).`,
        );
      }
    } else {
      warnings.push(`${file.name}: формат не підтримується.`);
    }
    done++;
  }
  if (frames.length === 0) {
    throw new Error(
      'Не завантажено жодного кадру. Підтримуються FITS (зображення та куби) і PNG/JPEG/WEBP.',
    );
  }
  const totalPixels = frames.reduce((sum, f) => sum + f.width * f.height, 0);
  const bytes = totalPixels * 4;
  if (bytes > MAX_BYTES) {
    throw new Error(
      `Набір займає ~${Math.round(bytes / 1024 / 1024)} МБ у памʼяті (ліміт ${Math.round(
        MAX_BYTES / 1024 / 1024,
      )} МБ). Зменште кількість або розмір кадрів.`,
    );
  }
  if (bytes > MAX_BYTES * 0.6) {
    warnings.push('Набір даних великий — браузер може працювати повільно. Розгляньте бінінг кадрів.');
  }
  const sorted =
    frames.every((f) => Number.isFinite(f.meta.jd)) && frames.length > 1
      ? [...frames].sort((a, b) => (a.meta.jd ?? 0) - (b.meta.jd ?? 0))
      : frames;
  const scales = sorted
    .map((f) => f.meta.pixelScale)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const pixelScale = scales.length ? median(scales) : undefined;
  const name =
    files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : `${files.length} файлів`;
  return {
    dataset: {
      id: `ds-${Date.now()}`,
      name,
      kind: sorted.length > 3 ? 'transit' : 'imaging',
      frames: sorted,
      pixelScale,
    },
    warnings,
  };
}
