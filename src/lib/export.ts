import type {
  BlsResult,
  Dataset,
  ImagingResult,
  Language,
  LightCurve,
  PhotometryResult,
  TransitFit,
  VettingResult,
} from '../types';

function f(value: number | undefined | null, digits = 4): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toExponential(3);
  return value.toFixed(digits);
}

function pct(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function ppm(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 1e6)} ppm`;
}

function lg(lang: Language, uk: string, en: string): string {
  return lang === 'uk' ? uk : en;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, jsonReplacer, 2), 'application/json;charset=utf-8');
}

/** Serialize typed arrays and NaNs predictably. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function lightCurveCsv(lc: LightCurve): string {
  const rows: string[] = ['time,flux,flux_err,raw'];
  for (let i = 0; i < lc.time.length; i++) {
    rows.push(
      [lc.time[i], lc.flux[i], lc.err[i], lc.raw[i]]
        .map((v) => (Number.isFinite(v) ? v.toPrecision(10) : ''))
        .join(','),
    );
  }
  return rows.join('\n');
}

export function phaseCsv(time: Float64Array, phase: Float64Array, flux: Float64Array, err: Float64Array, model: Float64Array): string {
  const rows: string[] = ['time,phase,flux,flux_err,model'];
  for (let i = 0; i < time.length; i++) {
    rows.push(
      [time[i], phase[i], flux[i], err[i], model[i]]
        .map((v) => (Number.isFinite(v) ? v.toPrecision(10) : ''))
        .join(','),
    );
  }
  return rows.join('\n');
}

export const REPORT_VERSION = '1.0';

export interface TransitReportInput {
  dataset: Dataset;
  phot: PhotometryResult;
  lc: LightCurve;
  bls: BlsResult;
  fit: TransitFit;
  vetting: VettingResult;
  lang: Language;
}

export function transitJson({
  dataset,
  phot,
  lc,
  bls,
  fit,
  vetting,
  lang,
}: TransitReportInput): unknown {
  return {
    app: 'ExoScope',
    version: REPORT_VERSION,
    language: lang,
    generatedAt: new Date().toISOString(),
    dataset: {
      name: dataset.name,
      frames: dataset.frames.length,
      width: dataset.frames[0]?.width,
      height: dataset.frames[0]?.height,
      pixelScale: dataset.pixelScale ?? null,
      timeSpanDays: phot.timeSpanDays,
      timeSource: phot.timeSource,
    },
    photometry: {
      referenceFrame: phot.refIndex + 1,
      targetStarId: lc.targetStar.id,
      targetX: lc.targetStar.x,
      targetY: lc.targetStar.y,
      aperturePx: phot.aperturePx,
      ensembleStars: lc.ensembleIds,
      settings: phot.settings,
      warnings: phot.warnings,
    },
    lightCurve: {
      points: lc.time.length,
      detrended: lc.detrended,
      binMinutes: lc.binMinutes,
      targetIndex: lc.targetIndex,
      warnings: lc.warnings,
    },
    bls: {
      best: bls.best,
      peaks: bls.peaks,
      sde: bls.sde,
      baselineDays: bls.baseline,
      options: bls.options,
    },
    transit: {
      params: fit.params,
      errors: fit.errors,
      snr: fit.snr,
      chi2: fit.chi2,
      dof: fit.dof,
      rmsPpm: fit.rms,
      events: fit.events,
      periodAtBoundary: fit.periodAtBoundary,
      warnings: fit.warnings,
    },
    vetting,
  };
}

export function transitReportMarkdown(input: TransitReportInput): string {
  const { dataset, phot, lc, bls, fit, vetting, lang } = input;
  const tr = (uk: string, en: string) => lg(lang, uk, en);
  const date = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# ExoScope — ${tr('звіт про транзитний пошук', 'transit search report')}`);
  lines.push('');
  lines.push(`${tr('Створено', 'Generated')}: ${date}`);
  lines.push('');
  lines.push(`## ${tr('Набір даних', 'Dataset')}`);
  lines.push('');
  lines.push(`- ${tr('Назва', 'Name')}: ${dataset.name}`);
  lines.push(`- ${tr('Кадрів', 'Frames')}: ${dataset.frames.length}`);
  lines.push(`- ${tr('Розмір', 'Size')}: ${dataset.frames[0]?.width} × ${dataset.frames[0]?.height} px`);
  lines.push(`- ${tr('Базова лінія', 'Baseline')}: ${f(phot.timeSpanDays, 4)} d`);
  lines.push(`- ${tr('Джерело часу', 'Time source')}: ${phot.timeSource}`);
  lines.push(`- ${tr('Піксельна шкала', 'Pixel scale')}: ${dataset.pixelScale ? `${f(dataset.pixelScale, 3)}″/px` : '—'}`);
  lines.push('');
  lines.push(`## ${tr('Фотометрія', 'Photometry')}`);
  lines.push('');
  lines.push(`- ${tr('Цільова зоря', 'Target star')}: S${lc.targetStar.id} (${f(lc.targetStar.x, 2)}, ${f(lc.targetStar.y, 2)})`);
  lines.push(`- ${tr('Апертура', 'Aperture')}: ${f(phot.aperturePx, 2)} px`);
  lines.push(`- ${tr('Зірок порівняння', 'Comparison stars')}: ${lc.ensembleIds.length}`);
  lines.push(`- ${tr('Точок кривої', 'Light-curve points')}: ${lc.time.length}`);
  lines.push(`- ${tr('Детрендинг', 'Detrending')}: ${lc.detrended ? tr('так', 'yes') : tr('ні', 'no')}`);
  lines.push('');
  lines.push(`## ${tr('Результат BLS', 'BLS result')}`);
  lines.push('');
  lines.push(`- ${tr('Період', 'Period')}: ${f(bls.best.period, 6)} d`);
  lines.push(`- ${tr('Глибина', 'Depth')}: ${ppm(bls.best.depth)}`);
  lines.push(`- ${tr('Тривалість', 'Duration')}: ${f(bls.best.durationDays * 24, 3)} h`);
  lines.push(`- SDE: ${f(bls.sde, 2)}`);
  lines.push('');
  lines.push(`## ${tr('Параметри транзиту', 'Transit parameters')}`);
  lines.push('');
  lines.push(`| ${tr('Параметр', 'Parameter')} | ${tr('Значення', 'Value')} | ${tr('Похибка', 'Uncertainty')} |`);
  lines.push('|---|---|---|');
  lines.push(`| ${tr('Період', 'Period')} (d) | ${f(fit.params.period, 6)} | ${f(fit.errors.period, 6)} |`);
  lines.push(`| T₀ (JD) | ${f(fit.params.t0, 6)} | ${f(fit.errors.t0, 6)} |`);
  lines.push(`| ${tr('Глибина', 'Depth')} (ppm) | ${ppm(fit.params.depth)} | ${ppm(fit.errors.depth)} |`);
  lines.push(`| T₁₄ (h) | ${f(fit.params.duration * 24, 3)} | ${f((fit.errors.duration ?? NaN) * 24, 3)} |`);
  lines.push(`| T₁₂ (h) | ${f(fit.params.ingress * 24, 3)} | ${f((fit.errors.ingress ?? NaN) * 24, 3)} |`);
  lines.push('');
  lines.push(`- SNRt: ${f(fit.snr, 2)}`);
  lines.push(`- χ²/dof: ${f(fit.chi2, 1)} / ${fit.dof}`);
  lines.push(`- RMS: ${f(fit.rms, 0)} ppm`);
  lines.push(`- ${tr('Подій', 'Events')}: ${fit.events.length}`);
  lines.push('');
  lines.push(`## ${tr('Веттинг', 'Vetting')}`);
  lines.push('');
  lines.push(`**${tr('Вердикт', 'Verdict')}: ${verdictLabel(vetting.verdict, lang)} — ${vetting.score.toFixed(0)}/100**`);
  lines.push('');
  lines.push(`| ${tr('Перевірка', 'Check')} | ${tr('Статус', 'Status')} | ${tr('Деталі', 'Details')} |`);
  lines.push('|---|---|---|');
  for (const flag of vetting.flags) {
    lines.push(`| ${flag.title} | ${severityLabel(flag.severity, lang)} | ${flag.detail.replace(/\|/g, '/')} |`);
  }
  lines.push('');
  lines.push(`## ${tr('Застереження', 'Warnings')}`);
  lines.push('');
  const warnings = [...phot.warnings, ...lc.warnings, ...fit.warnings];
  if (warnings.length) for (const warning of warnings) lines.push(`- ${warning}`);
  else lines.push(tr('Немає.', 'None.'));
  lines.push('');
  lines.push(
    tr(
      'Цей звіт створено автоматичним конвеєром ExoScope. Кандидат потребує перевірки та спектроскопічного підтвердження; автоматичний аналіз не є відкриттям екзопланети.',
      'This report was produced by the automated ExoScope pipeline. A candidate requires follow-up and spectroscopic confirmation; automated analysis is not an exoplanet discovery.',
    ),
  );
  return lines.join('\n');
}

export function verdictLabel(verdict: VettingResult['verdict'], lang: Language): string {
  const map: Record<VettingResult['verdict'], [string, string]> = {
    strong: ['сильний кандидат', 'strong candidate'],
    candidate: ['кандидат', 'candidate'],
    weak: ['слабкий сигнал', 'weak signal'],
    'false-positive': ['ймовірний хибнопозитив', 'likely false positive'],
    insufficient: ['недостатньо даних', 'insufficient data'],
  };
  return map[verdict][lang === 'uk' ? 0 : 1];
}

export function severityLabel(severity: string, lang: Language): string {
  const map: Record<string, [string, string]> = {
    good: ['добре', 'good'],
    warn: ['увага', 'warning'],
    bad: ['проблема', 'issue'],
    unknown: ['невідомо', 'unknown'],
  };
  return (map[severity] ?? ['—', '—'])[lang === 'uk' ? 0 : 1];
}

export interface ImagingReportInput {
  dataset: Dataset;
  result: ImagingResult;
  lang: Language;
}

export function imagingCandidatesCsv(result: ImagingResult): string {
  const rows = ['id,x,y,sep_px,sep_arcsec,pa_deg,snr,contrast,delta_mag'];
  for (const c of result.candidates) {
    rows.push(
      [
        c.id,
        c.x.toPrecision(8),
        c.y.toPrecision(8),
        c.sepPx.toFixed(3),
        c.sepArcsec.toFixed(4),
        c.pa.toFixed(2),
        c.snr.toFixed(3),
        c.contrast.toExponential(5),
        c.contrastMag.toFixed(3),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function contrastCurveCsv(result: ImagingResult): string {
  const rows = ['sep_px,sep_arcsec,sigma,contrast_1sigma,contrast_5sigma,delta_mag_5sigma'];
  for (const p of result.contrastCurve) {
    rows.push(
      [
        p.sepPx.toFixed(3),
        p.sepArcsec.toFixed(4),
        p.sigma.toExponential(5),
        p.contrast1.toExponential(5),
        p.contrast5.toExponential(5),
        p.contrast5Mag.toFixed(3),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function imagingJson({ dataset, result, lang }: ImagingReportInput): unknown {
  return {
    app: 'ExoScope',
    version: REPORT_VERSION,
    language: lang,
    generatedAt: new Date().toISOString(),
    dataset: {
      name: dataset.name,
      frames: dataset.frames.length,
      width: dataset.frames[0]?.width,
      height: dataset.frames[0]?.height,
      pixelScale: dataset.pixelScale ?? null,
    },
    settings: result.settings,
    center: result.center,
    framesUsed: result.framesUsed,
    totalRotationDeg: result.totalRotation,
    angleSource: result.angleSource,
    starPeak: result.starPeak,
    contrastCurve: result.contrastCurve,
    candidates: result.candidates,
    warnings: result.warnings,
    elapsedMs: result.elapsedMs,
  };
}

export function imagingReportMarkdown({ dataset, result, lang }: ImagingReportInput): string {
  const tr = (uk: string, en: string) => lg(lang, uk, en);
  const lines: string[] = [];
  lines.push(`# ExoScope — ${tr('звіт про пряме зображення', 'direct imaging report')}`);
  lines.push('');
  lines.push(`${tr('Створено', 'Generated')}: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## ${tr('Набір даних', 'Dataset')}`);
  lines.push('');
  lines.push(`- ${tr('Назва', 'Name')}: ${dataset.name}`);
  lines.push(`- ${tr('Кадрів у наборі', 'Frames in dataset')}: ${dataset.frames.length}`);
  lines.push(`- ${tr('Використано кадрів', 'Frames used')}: ${result.framesUsed}`);
  lines.push(`- ${tr('Розмір', 'Size')}: ${result.width} × ${result.height} px`);
  lines.push(`- ${tr('Піксельна шкала', 'Pixel scale')}: ${f(result.settings.pixelScale, 3)}″/px`);
  lines.push(`- ${tr('Обертання поля', 'Field rotation')}: ${f(result.totalRotation, 1)}°`);
  lines.push(`- ${tr('Джерело кутів', 'Angle source')}: ${result.angleSource}`);
  lines.push(`- ${tr('Центр', 'Center')}: (${f(result.center.x, 2)}, ${f(result.center.y, 2)}) px`);
  lines.push('');
  lines.push(`## ${tr('Кандидати', 'Candidates')}`);
  lines.push('');
  if (result.candidates.length) {
    lines.push(
      `| # | ${tr('Відстань', 'Separation')} (px) | (″) | PA (°) | SNR | ${tr('Контраст', 'Contrast')} | Δmag |`,
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const candidate of result.candidates) {
      lines.push(
        `| ${candidate.id} | ${f(candidate.sepPx, 1)} | ${f(candidate.sepArcsec, 2)} | ${f(candidate.pa, 1)} | ${f(candidate.snr, 2)} | ${candidate.contrast.toExponential(2)} | ${f(candidate.contrastMag, 2)} |`,
      );
    }
  } else {
    lines.push(tr('Кандидатів вище порогу не знайдено.', 'No candidates above the threshold.'));
  }
  lines.push('');
  lines.push(`## ${tr('Крива контрастності (5σ)', 'Contrast curve (5σ)')}`);
  lines.push('');
  lines.push(`| ${tr('Відстань', 'Separation')} (″) | 5σ Δmag |`);
  lines.push('|---|---|');
  for (const point of result.contrastCurve.filter((_, index) => index % 2 === 0)) {
    lines.push(`| ${f(point.sepArcsec, 2)} | ${f(point.contrast5Mag, 2)} |`);
  }
  lines.push('');
  lines.push(`## ${tr('Застереження', 'Warnings')}`);
  lines.push('');
  if (result.warnings.length) for (const warning of result.warnings) lines.push(`- ${warning}`);
  else lines.push(tr('Немає.', 'None.'));
  lines.push('');
  lines.push(
    tr(
      'ADI/RDI-аналіз чутливий до артефактів PSF та помилок кутів. Кандидат потребує перевірки на інших епохах і довжинах хвиль, а також астрометричного підтвердження.',
      'ADI/RDI analysis is sensitive to PSF artefacts and angle errors. A candidate needs multi-epoch, multi-wavelength follow-up and astrometric confirmation.',
    ),
  );
  return lines.join('\n');
}

const SVG_STYLE = `
text { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
.chart-grid { stroke: rgba(126,163,255,0.13); stroke-width: 1; }
.chart-tick { fill: #93a1bd; font-size: 11px; }
.chart-axis-label { fill: #93a1bd; font-size: 12px; letter-spacing: .02em; }
.chart-marker-label { font-size: 11px; font-weight: 600; }
.chart-tooltip-bg { fill: rgba(10,16,32,0.94); stroke: rgba(126,163,255,0.3); }
.chart-tooltip-title { fill: #e7edf9; font-size: 11px; font-weight: 600; }
.chart-tooltip-row { fill: #b9c5dc; font-size: 11px; }
.chart-plot-bg { fill: rgba(8,13,26,0.55); }
`;

export async function downloadSvgPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const viewBox = (clone.getAttribute('viewBox') ?? '0 0 920 340').split(/\s+/).map(Number);
  const width = viewBox[2] || 920;
  const height = viewBox[3] || 340;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = SVG_STYLE;
  clone.insertBefore(style, clone.firstChild);
  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG render failed'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    await downloadCanvasPng(canvas, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(filename, blob);
      resolve();
    }, 'image/png');
  });
}

export function safeFileStem(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) || 'exoscope'
  );
}

export { f as formatValue, pct as formatPercent, ppm as formatPpm };
