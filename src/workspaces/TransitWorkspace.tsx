import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  BlsPeak,
  BlsResult,
  DetectionResult,
  LightCurve,
  LcOptions,
  PhotometryResult,
  PhotometrySettings,
  ProgressInfo,
  TransitFit,
  VettingResult,
} from '../types';
import { useDataset, errorMessage } from '../hooks/useDataset';
import { useI18n } from '../i18n';
import { detectStars } from '../lib/detect';
import { runPhotometry } from '../lib/photometry';
import { buildLightCurve } from '../lib/lightcurve';
import { searchBlsAsync } from '../lib/blsClient';
import { fitTransit, phaseOf } from '../lib/transit';
import { vetTransit } from '../lib/vetting';
import { estimateCadenceDays, resolveTimes } from '../lib/times';
import { median } from '../lib/stats';
import { weightedBin } from '../lib/stats';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  EmptyState,
  Field,
  NumberInput,
  Progress,
  RangeInput,
  SelectInput,
  Stat,
  StatGrid,
  StepHeader,
} from '../components/Common';
import { Chart } from '../components/Chart';
import { ImageCanvas } from '../components/ImageCanvas';
import { UploadZone } from '../components/UploadZone';
import { Icon } from '../components/Icons';
import {
  downloadJson,
  downloadSvgPng,
  downloadText,
  formatPercent,
  formatValue,
  lightCurveCsv,
  phaseCsv,
  safeFileStem,
  transitJson,
  transitReportMarkdown,
  verdictLabel,
} from '../lib/export';
import type { DemoSignal } from '../App';

const ACCEPT = '.fits,.fit,.fts,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 24));

const fmt = (value: number | undefined | null, digits = 3): string =>
  formatValue(value ?? NaN, digits);

const ppm = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 0.01) return `${(value * 100).toFixed(1)}%`;
  return `${Math.round(value * 1e6)} ppm`;
};

const numOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

function StepCard({
  index,
  title,
  subtitle,
  done,
  aside,
  children,
  className = '',
}: {
  index: number;
  title: string;
  subtitle?: string;
  done?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`step-card ${className}`}>
      <StepHeader index={index} title={title} subtitle={subtitle} done={done} aside={aside} />
      <div className="step-body">{children}</div>
    </section>
  );
}

const defaultPhotometry: PhotometrySettings = {
  thresholdSigma: 5,
  apertureFactor: 1.6,
  annulusGap: 3,
  annulusWidth: 6,
  gain: 1,
  readNoise: 4,
  maxStars: 250,
  autoAlign: true,
};

const defaultLcOptions: LcOptions = {
  targetIndex: 0,
  detrendOrder: 1,
  useFwhm: false,
  useSky: true,
  useAirmass: true,
  useCentroid: true,
  clipSigma: 4,
  binMinutes: 0,
  variableClip: 2,
};

const defaultBlsOptions = {
  minPeriod: 0.3,
  maxPeriod: 10,
  nPeriods: 3000,
  minDurationHours: 0.7,
  maxDurationHours: 8,
  nBins: 220,
};

export function TransitWorkspace({ demoSignal }: { demoSignal: DemoSignal | null }) {
  const { t, td, lang } = useI18n();
  const {
    dataset,
    busy: loaderBusy,
    progress: loaderProgress,
    error: loaderError,
    warnings: datasetWarnings,
    loadFiles,
    loadDemo,
    setError: setLoaderError,
    reset: resetDataset,
    dismissWarnings,
  } = useDataset('transit');

  const [refIndex, setRefIndex] = useState(0);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [targetIndex, setTargetIndex] = useState(0);
  const [phot, setPhot] = useState<PhotometryResult | null>(null);
  const [lc, setLc] = useState<LightCurve | null>(null);
  const [bls, setBls] = useState<BlsResult | null>(null);
  const [fit, setFit] = useState<TransitFit | null>(null);
  const [vet, setVet] = useState<VettingResult | null>(null);
  const [selectedPeak, setSelectedPeak] = useState(0);
  const [busy, setBusy] = useState<null | 'detect' | 'phot' | 'bls' | 'fit'>(null);
  const [taskProgress, setTaskProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackStart, setFallbackStart] = useState(2460000.5);
  const [cadenceMinutes, setCadenceMinutes] = useState(10);
  const [photSettings, setPhotSettings] = useState<PhotometrySettings>(defaultPhotometry);
  const [lcOptions, setLcOptions] = useState<LcOptions>(defaultLcOptions);
  const [blsOptions, setBlsOptions] = useState(defaultBlsOptions);
  const [blsPreset, setBlsPreset] = useState<'custom' | 'fast' | 'balanced' | 'deep'>('balanced');

  function applyBlsPreset(preset: 'fast' | 'balanced' | 'deep') {
    setBlsPreset(preset);
    const presets = {
      fast: { nPeriods: 1200, nBins: 160 },
      balanced: { nPeriods: 3000, nBins: 220 },
      deep: { nPeriods: 8000, nBins: 320 },
    } as const;
    setBlsOptions((prev) => ({ ...prev, ...presets[preset] }));
  }

  const lcSvgRef = useRef<SVGSVGElement>(null);
  const phaseSvgRef = useRef<SVGSVGElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const processedDemo = useRef(0);

  const timeInfo = useMemo(() => {
    if (!dataset) return null;
    return resolveTimes(dataset.frames, {
      startJd: fallbackStart,
      cadenceDays: Math.max(0, cadenceMinutes) / 1440,
    });
  }, [dataset, fallbackStart, cadenceMinutes]);

  const timeStats = useMemo(() => {
    if (!timeInfo || timeInfo.times.length < 2) return null;
    const times = timeInfo.times;
    const baseline = times[times.length - 1] - times[0];
    const cadence = estimateCadenceDays(times);
    return { baseline, cadence };
  }, [timeInfo]);

  const datasetId = dataset?.id ?? null;

  useEffect(() => {
    if (!dataset) return;
    const first = dataset.frames[0];
    setRefIndex(0);
    setDetection(null);
    setTargetIndex(0);
    setPhot(null);
    setLc(null);
    setBls(null);
    setFit(null);
    setVet(null);
    setSelectedPeak(0);
    setBusy(null);
    setTaskProgress(null);
    setError(null);
    setPhotSettings((prev) => ({
      ...prev,
      gain: numOr(first.meta.gain, prev.gain),
      readNoise: numOr(first.meta.readNoise, prev.readNoise),
    }));
    if (Number.isFinite(first.meta.jd)) setFallbackStart(Number(first.meta.jd!.toFixed(6)));
    const times = resolveTimes(dataset.frames, {
      startJd: first.meta.jd ?? 2460000.5,
      cadenceDays: 0.01,
    }).times;
    const cadence = estimateCadenceDays(times);
    if (cadence > 0) setCadenceMinutes(Number((cadence * 1440).toFixed(2)));
    const baseline = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    setLcOptions((prev) => ({ ...prev, targetIndex: 0 }));
    setBlsOptions((prev) => ({
      ...prev,
      minPeriod: Math.max(0.04, cadence > 0 ? cadence * 8 : 0.1),
      maxPeriod: Math.max(0.5, Math.min(40, baseline > 0 ? baseline * 0.9 : 5)),
    }));
  }, [datasetId]);

  useEffect(() => {
    if (demoSignal && demoSignal.nonce !== processedDemo.current) {
      processedDemo.current = demoSignal.nonce;
      void loadDemo();
    }
  }, [demoSignal, loadDemo]);

  // Rebuild the light curve whenever photometry, target or detrending changes.
  useEffect(() => {
    if (!phot) {
      setLc(null);
      return;
    }
    try {
      const next = buildLightCurve(phot, lcOptions);
      setLc(next);
      setBls(null);
      setFit(null);
      setVet(null);
      setSelectedPeak(0);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [phot, lcOptions]);

  const targetStar = detection?.stars[targetIndex];

  const starMarkers = useMemo(() => {
    if (!detection) return [];
    const labeled = new Set(detection.stars.slice(0, 6).map((star) => star.id));
    return detection.stars.map((star) => ({
      x: star.x,
      y: star.y,
      kind: star.id === targetStar?.id ? ('target' as const) : ('star' as const),
      label:
        star.id === targetStar?.id || labeled.has(star.id) ? `S${star.id}` : undefined,
    }));
  }, [detection, targetStar?.id]);

  const lcChart = useMemo(() => {
    if (!lc) return null;
    let binned: ReturnType<typeof weightedBin> | null = null;
    if (lcOptions.binMinutes > 0) {
      binned = weightedBin(lc.time, lc.flux, lc.err, lcOptions.binMinutes / 1440);
    }
    const valid = Array.from(lc.flux).filter((v) => Number.isFinite(v) && v > 0);
    const rmsPpm = valid.length > 3 ? median(valid) : NaN;
    let scatter = 0;
    if (valid.length > 3) {
      let sum = 0;
      for (const v of valid) sum += (v - 1) ** 2;
      scatter = Math.sqrt(sum / valid.length) * 1e6;
    }
    let binnedScatter = NaN;
    if (binned) {
      let sum = 0;
      let count = 0;
      for (const v of binned.flux) {
        if (Number.isFinite(v)) {
          sum += (v - 1) ** 2;
          count++;
        }
      }
      if (count > 2) binnedScatter = Math.sqrt(sum / count) * 1e6;
    }
    const errors = Array.from(lc.err).filter((v) => Number.isFinite(v) && v > 0);
    return {
      binned,
      rmsPpm: scatter,
      binnedScatter,
      medianErrPpm: errors.length ? median(errors) * 1e6 : NaN,
      medianFlux: rmsPpm,
      points: valid.length,
    };
  }, [lc, lcOptions.binMinutes]);

  const blsChart = useMemo(() => {
    if (!bls) return null;
    const periods = new Float64Array(bls.spectrum.length);
    const scores = new Float64Array(bls.spectrum.length);
    let max = 0;
    for (let i = 0; i < bls.spectrum.length; i++) {
      periods[i] = bls.spectrum[i].period;
      scores[i] = bls.spectrum[i].score;
      if (scores[i] > max) max = scores[i];
    }
    return { periods, scores, max };
  }, [bls]);

  const phaseChart = useMemo(() => {
    if (!fit || !lc) return null;
    const n = lc.time.length;
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
      if (
        Number.isFinite(lc.time[i]) &&
        Number.isFinite(lc.flux[i]) &&
        Number.isFinite(fit.modelFlux[i])
      ) {
        order.push(i);
      }
    }
    order.sort(
      (a, b) =>
        phaseOf(lc.time[a], fit.params.period, fit.params.t0) -
        phaseOf(lc.time[b], fit.params.period, fit.params.t0),
    );
    const phase = new Float64Array(order.length);
    const flux = new Float64Array(order.length);
    const model = new Float64Array(order.length);
    const time = new Float64Array(order.length);
    const err = new Float64Array(order.length);
    for (let i = 0; i < order.length; i++) {
      const index = order[i];
      phase[i] = phaseOf(lc.time[index], fit.params.period, fit.params.t0);
      flux[i] = lc.flux[index];
      model[i] = fit.modelFlux[index];
      time[i] = lc.time[index];
      err[i] = lc.err[index];
    }
    const errors = Array.from(lc.err).filter((v) => Number.isFinite(v) && v > 0);
    const medianErr = errors.length ? median(errors) : 0.001;
    const depth = Math.max(fit.params.depth, 1e-5);
    const spread = Math.max(depth * 2.1, medianErr * 5);
    return {
      phase,
      flux,
      model,
      time,
      err,
      yDomain: [1 - spread, 1 + Math.max(depth * 0.6, medianErr * 2)] as [number, number],
    };
  }, [fit, lc]);

  const reportReady = Boolean(dataset && phot && lc && bls && fit && vet);

  async function handleDetect() {
    if (!dataset) return;
    setBusy('detect');
    setError(null);
    setTaskProgress({ label: t('Пошук зірок на референсному кадрі'), value: 0.15 });
    try {
      await tick();
      const frame = dataset.frames[Math.min(refIndex, dataset.frames.length - 1)];
      const result = detectStars(frame, {
        thresholdSigma: photSettings.thresholdSigma,
        maxStars: photSettings.maxStars,
      });
      if (!result.stars.length) {
        throw new Error(
          t(
            'Зірок не знайдено. Зменште поріг виявлення або перевірте референсний кадр.',
          ),
        );
      }
      setDetection(result);
      let chosen = 0;
      const hint = dataset.targetHint;
      if (hint) {
        let bestDistance = Infinity;
        for (let i = 0; i < result.stars.length; i++) {
          const star = result.stars[i];
          const distance = Math.hypot(star.x - hint.x, star.y - hint.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            chosen = i;
          }
        }
        if (bestDistance > Math.max(12, result.medianFwhm * 3)) {
          const fallback = result.stars.findIndex((star) => !star.saturated);
          chosen = fallback >= 0 ? fallback : 0;
        }
      } else {
        const fallback = result.stars.findIndex((star) => !star.saturated);
        chosen = fallback >= 0 ? fallback : 0;
      }
      setTargetIndex(chosen);
      setLcOptions((prev) => ({ ...prev, targetIndex: chosen }));
      setPhot(null);
      setLc(null);
      setBls(null);
      setFit(null);
      setVet(null);
      setTaskProgress({ label: t('Готово'), value: 1 });
    } catch (err) {
      setError(errorMessage(err));
      setTaskProgress(null);
    } finally {
      setBusy(null);
    }
  }

  async function handlePhotometry() {
    if (!dataset || !detection || !timeInfo) return;
    setBusy('phot');
    setError(null);
    setTaskProgress({ label: t('Підготовка фотометрії'), value: 0.01 });
    try {
      await tick();
      const result = await runPhotometry(
        {
          frames: dataset.frames,
          refIndex: Math.min(refIndex, dataset.frames.length - 1),
          detection,
          settings: photSettings,
          times: timeInfo.times,
          timeSource: timeInfo.source,
          timesAreAbsolute: timeInfo.absolute,
        },
        (value, label) => setTaskProgress({ label, value }),
      );
      setPhot(result);
      setLcOptions((prev) => ({ ...prev, targetIndex }));
      setTaskProgress({ label: t('Фотометрія завершена'), value: 1 });
    } catch (err) {
      setError(errorMessage(err));
      setTaskProgress(null);
    } finally {
      setBusy(null);
    }
  }

  function selectTarget(index: number) {
    if (!detection || index < 0 || index >= detection.stars.length) return;
    setTargetIndex(index);
    setLcOptions((prev) => ({ ...prev, targetIndex: index }));
    setBls(null);
    setFit(null);
    setVet(null);
    setSelectedPeak(0);
  }

  async function computeFit(peak: BlsPeak) {
    if (!phot || !lc) return;
    setBusy('fit');
    setError(null);
    setTaskProgress({ label: t('Фіт транзитної моделі та веттинг'), value: 0.35 });
    try {
      await tick();
      const fitResult = fitTransit(lc.time, lc.flux, lc.err, peak);
      const vetResult = vetTransit(phot, lc, fitResult);
      setFit(fitResult);
      setVet(vetResult);
      setTaskProgress({ label: t('Готово'), value: 1 });
    } catch (err) {
      setError(errorMessage(err));
      setTaskProgress(null);
    } finally {
      setBusy(null);
    }
  }

  async function handleBls() {
    if (!lc) return;
    setBusy('bls');
    setError(null);
    setTaskProgress({ label: t('BLS-пошук періоду'), value: 0 });
    try {
      const result = await searchBlsAsync(
        lc.time,
        lc.flux,
        lc.err,
        { ...blsOptions, nPeriods: Math.round(blsOptions.nPeriods), nBins: Math.round(blsOptions.nBins) },
        (fraction, bestScore) =>
          setTaskProgress({
            label: `${t('BLS-пошук')} · ${t('найкращий score')} ${bestScore.toFixed(1)}`,
            value: fraction,
          }),
      );
      setBls(result);
      setSelectedPeak(0);
      await computeFit(result.best);
    } catch (err) {
      setError(errorMessage(err));
      setTaskProgress(null);
    } finally {
      setBusy(null);
    }
  }

  function choosePeak(index: number) {
    if (!bls) return;
    const peak = bls.peaks[index];
    if (!peak) return;
    setSelectedPeak(index);
    void computeFit(peak);
  }

  function onImageClick(x: number, y: number) {
    if (!detection) return;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < detection.stars.length; i++) {
      const star = detection.stars[i];
      const distance = Math.hypot(star.x - x, star.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best >= 0 && bestDistance <= Math.max(5, (detection.medianFwhm || 3) * 1.6)) {
      selectTarget(best);
    }
  }

  function changeRefIndex(next: number) {
    if (!dataset) return;
    const clamped = Math.max(0, Math.min(dataset.frames.length - 1, next));
    setRefIndex(clamped);
    setDetection(null);
    setPhot(null);
    setLc(null);
    setBls(null);
    setFit(null);
    setVet(null);
  }

  const stem = safeFileStem(dataset?.name ?? 'exoscope');

  function exportLightCurveCsv() {
    if (!lc) return;
    downloadText(`${stem}_lightcurve.csv`, lightCurveCsv(lc), 'text/csv;charset=utf-8');
  }

  function exportPhaseCsv() {
    if (!phaseChart) return;
    downloadText(
      `${stem}_phase.csv`,
      phaseCsv(phaseChart.time, phaseChart.phase, phaseChart.flux, phaseChart.err, phaseChart.model),
      'text/csv;charset=utf-8',
    );
  }

  function exportJson() {
    if (!dataset || !phot || !lc || !bls || !fit || !vet) return;
    downloadJson(`${stem}_transit.json`, transitJson({ dataset, phot, lc, bls, fit, vetting: vet, lang }));
  }

  function exportReport() {
    if (!dataset || !phot || !lc || !bls || !fit || !vet) return;
    downloadText(
      `${stem}_report.md`,
      transitReportMarkdown({ dataset, phot, lc, bls, fit, vetting: vet, lang }),
      'text/markdown;charset=utf-8',
    );
  }

  async function saveChart(ref: RefObject<SVGSVGElement | null>, name: string) {
    if (!ref.current) return;
    try {
      await downloadSvgPng(ref.current, name);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const activeProgress = loaderProgress ?? taskProgress;

  return (
    <div className="page workspace-page">
      <header className="workspace-head">
        <div>
          <span className="eyebrow">
            <Icon name="transit" size={14} /> {t('Транзитна фотометрія')}
          </span>
          <h1>{t('Пошук екзопланет за транзитами')}</h1>
          <p>
            {t(
              'Завантажте серію кадрів зорі, виберіть ціль і пройдіть конвеєр: виявлення зірок → диференціальна фотометрія → BLS → фіт → веттинг.',
            )}
          </p>
        </div>
        <div className="workspace-badges">
          <Badge tone="violet">{t('FITS · куби · PNG')}</Badge>
          <Badge tone="accent">{t('Web Worker BLS')}</Badge>
        </div>
      </header>

      {dataset && (
        <div className="dataset-bar">
          <div className="dataset-bar-main">
            <span className="dataset-icon">
              <Icon name="layers" size={18} />
            </span>
            <div>
              <strong>{dataset.name}</strong>
              <span>
                {dataset.frames.length} {t('кадрів')} · {dataset.frames[0]?.width} ×{' '}
                {dataset.frames[0]?.height} px ·{' '}
                {dataset.pixelScale ? `${fmt(dataset.pixelScale, 3)}″/px` : t('шкала невідома')}
              </span>
            </div>
          </div>
          <div className="dataset-bar-actions">
            <input
              ref={replaceInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length) void loadFiles(files);
              }}
            />
            <Button
              icon="upload"
              variant="secondary"
              disabled={Boolean(loaderBusy) || Boolean(busy)}
              onClick={() => replaceInputRef.current?.click()}
            >
              {t('Замінити')}
            </Button>
            <Button
              icon="spark"
              variant="ghost"
              disabled={Boolean(loaderBusy) || Boolean(busy)}
              onClick={() => void loadDemo()}
            >
              {t('Демо')}
            </Button>
            <Button
              icon="refresh"
              variant="ghost"
              disabled={Boolean(loaderBusy) || Boolean(busy)}
              onClick={resetDataset}
            >
              {t('Очистити')}
            </Button>
          </div>
        </div>
      )}

      {loaderError && (
        <Alert tone="bad" title={t('Не вдалося завантажити дані')} onClose={() => setLoaderError(null)}>
          {td(loaderError)}
        </Alert>
      )}
      {error && (
        <Alert tone="bad" title={t('Помилка обробки')} onClose={() => setError(null)}>
          {td(error)}
        </Alert>
      )}
      {loaderBusy && loaderProgress && (
        <div className="task-banner">
          <Progress value={loaderProgress.value} label={loaderProgress.label} detail={loaderProgress.detail} />
        </div>
      )}
      {busy && taskProgress && (
        <div className="task-banner">
          <Progress value={taskProgress.value} label={taskProgress.label} detail={taskProgress.detail} />
        </div>
      )}

      {!dataset && (
        <Card title={t('Почніть із даних')} icon="upload" subtitle={t('Дані обробляються локально у браузері.')}>
          <UploadZone onFiles={(files) => void loadFiles(files)} disabled={Boolean(loaderBusy)} />
          <div className="start-demo">
            <div>
              <strong>{t('Немає кадрів під рукою?')}</strong>
              <p>
                {t(
                  'Згенеруйте синтетичну серію з транзитом гарячого юпітера: 260 кадрів, 3 транзити, змінна зоря порівняння.',
                )}
              </p>
            </div>
            <Button icon="play" variant="primary" loading={loaderBusy === 'demo'} onClick={() => void loadDemo()}>
              {t('Завантажити демо-транзит')}
            </Button>
          </div>
        </Card>
      )}

      {dataset && (
        <StepCard
          index={1}
          title={t('Дані та час')}
          subtitle={t('Перевірте часову шкалу, кадри та референсне зображення.')}
          done={Boolean(detection)}
          aside={
            <Badge tone={timeInfo?.absolute ? 'good' : 'warn'} dot>
              {timeInfo?.absolute ? t('абсолютний час') : t('відносний час')}
            </Badge>
          }
        >
          <StatGrid>
            <Stat label={t('Кадрів')} value={dataset.frames.length} hint={`${dataset.frames[0]?.width} × ${dataset.frames[0]?.height} px`} />
            <Stat
              label={t('Базова лінія')}
              value={timeStats ? `${fmt(timeStats.baseline, 4)} ${t('діб')}` : '—'}
              hint={
                timeStats
                  ? `${fmt(timeStats.baseline * 24, 2)} ${t('годин')}`
                  : t('потрібно ≥2 кадри')
              }
            />
            <Stat
              label={t('Крок')}
              value={timeStats ? `${fmt(timeStats.cadence * 1440, 2)} ${t('хв')}` : '—'}
              hint={t('медіанний інтервал')}
            />
            <Stat
              label={t('Джерело часу')}
              value={<span className="stat-value-small">{timeInfo ? t(timeInfo.source) : '—'}</span>}
              hint={timeInfo?.absolute ? t('JD / BJD / DATE-OBS') : t('порядковий номер')}
            />
          </StatGrid>

          <div className="form-grid four">
            <Field label={t('Резервний початковий JD')} hint={t('Якщо у FITS немає часу')}>
              <NumberInput
                value={fallbackStart}
                step={0.0001}
                onChange={(value) => setFallbackStart(value)}
              />
            </Field>
            <Field label={t('Крок, хвилин')} hint={t('Використовується без часових заголовків')}>
              <NumberInput value={cadenceMinutes} min={0.01} step={0.1} onChange={setCadenceMinutes} />
            </Field>
            <Field label={t('Референсний кадр')} hint={`${t('з')} ${dataset.frames.length}`}>
              <NumberInput
                value={refIndex + 1}
                min={1}
                max={dataset.frames.length}
                step={1}
                onChange={(value) => changeRefIndex(Math.round(value) - 1)}
              />
            </Field>
            <Field label={t('Часова мітка')} hint={t('Формат відображення')}>
              <SelectInput
                value="jd"
                onChange={() => undefined}
                options={[
                  { value: 'jd', label: 'JD' },
                  { value: 'bjd', label: 'BJD (як у заголовку)' },
                ]}
              />
            </Field>
          </div>

          {datasetWarnings.length > 0 && (
            <Alert tone="warn" title={t('Попередження читання файлів')} onClose={dismissWarnings}>
              <ul className="alert-list">
                {datasetWarnings.map((warning, index) => (
                  <li key={index}>{td(warning)}</li>
                ))}
              </ul>
            </Alert>
          )}
          {timeInfo && timeInfo.warnings.length > 0 && (
            <details className="inline-details">
              <summary>
                {t('Часові попередження')} ({timeInfo.warnings.length})
              </summary>
              <ul>
                {timeInfo.warnings.map((warning, index) => (
                  <li key={index}>{td(warning)}</li>
                ))}
              </ul>
            </details>
          )}
          {dataset.demo && dataset.notes && (
            <Alert tone="info" title={t('Демонстраційний набір')}>
              {dataset.notes}
            </Alert>
          )}
        </StepCard>
      )}

      {dataset && (
        <StepCard
          index={2}
          title={t('Зорі та фотометрія')}
          subtitle={t('Налаштуйте виявлення, виберіть цільову зорю та виміряйте криву світла.')}
          done={Boolean(phot)}
          aside={phot ? <Badge tone="good" dot>{t('фотометрія готова')}</Badge> : undefined}
        >
          <div className="split-layout">
            <div className="split-main">
              {detection ? (
                <>
                  <ImageCanvas
                    data={dataset.frames[Math.min(refIndex, dataset.frames.length - 1)].data}
                    width={dataset.frames[Math.min(refIndex, dataset.frames.length - 1)].width}
                    height={dataset.frames[Math.min(refIndex, dataset.frames.length - 1)].height}
                    markers={starMarkers}
                    onClick={onImageClick}
                    ariaLabel={t('Референсний кадр із виявленими зорями')}
                    maxHeight={520}
                  />
                  <p className="caption">
                    {t(
                      'Клікніть на зорю, щоб вибрати ціль. Помаранчеве коло — цільова зоря; блакитні — всі виявлені джерела.',
                    )}
                  </p>
                </>
              ) : (
                <div className="preview-placeholder">
                  <Icon name="star" size={30} />
                  <h3>{t('Зорі ще не виявлено')}</h3>
                  <p>
                    {t(
                      'Натисніть «Знайти зорі», щоб побудувати карту фону, знайти джерела та виміряти FWHM.',
                    )}
                  </p>
                  <Button icon="star" variant="primary" loading={busy === 'detect'} onClick={() => void handleDetect()}>
                    {t('Знайти зорі')}
                  </Button>
                </div>
              )}
            </div>

            <div className="split-side">
              <div className="panel-title">{t('Виявлення')}</div>
              <div className="form-grid two">
                <Field label={`${t('Поріг')} (σ)`}>
                  <RangeInput
                    min={3}
                    max={12}
                    step={0.5}
                    value={photSettings.thresholdSigma}
                    onChange={(value) =>
                      setPhotSettings((prev) => ({ ...prev, thresholdSigma: value }))
                    }
                    format={(value) => `${value.toFixed(1)}σ`}
                  />
                </Field>
                <Field label={t('Зірок максимум')}>
                  <NumberInput
                    min={20}
                    max={1200}
                    step={10}
                    value={photSettings.maxStars}
                    onChange={(value) =>
                      setPhotSettings((prev) => ({ ...prev, maxStars: Math.round(value) }))
                    }
                  />
                </Field>
              </div>

              <Divider label={t('Апертурна фотометрія')} />
              <div className="form-grid two">
                <Field label={t('Апертура × FWHM')}>
                  <RangeInput
                    min={1}
                    max={3}
                    step={0.05}
                    value={photSettings.apertureFactor}
                    onChange={(value) =>
                      setPhotSettings((prev) => ({ ...prev, apertureFactor: value }))
                    }
                    format={(value) => value.toFixed(2)}
                  />
                </Field>
                <Field label={t('Розрив кільця, px')}>
                  <NumberInput
                    min={1}
                    max={20}
                    step={1}
                    value={photSettings.annulusGap}
                    onChange={(value) =>
                      setPhotSettings((prev) => ({ ...prev, annulusGap: Math.round(value) }))
                    }
                  />
                </Field>
                <Field label={t('Ширина кільця, px')}>
                  <NumberInput
                    min={2}
                    max={30}
                    step={1}
                    value={photSettings.annulusWidth}
                    onChange={(value) =>
                      setPhotSettings((prev) => ({ ...prev, annulusWidth: Math.round(value) }))
                    }
                  />
                </Field>
                <Field label={t('GAIN, e⁻/ADU')}>
                  <NumberInput
                    min={0.01}
                    step={0.1}
                    value={photSettings.gain}
                    onChange={(value) => setPhotSettings((prev) => ({ ...prev, gain: value }))}
                  />
                </Field>
                <Field label={t('READNOISE, e⁻')}>
                  <NumberInput
                    min={0}
                    max={100}
                    step={0.5}
                    value={photSettings.readNoise}
                    onChange={(value) => setPhotSettings((prev) => ({ ...prev, readNoise: value }))}
                  />
                </Field>
                <Field label={t('Вирівнювання')}>
                  <Checkbox
                    checked={photSettings.autoAlign}
                    onChange={(value) =>
                      setPhotSettings((prev) => ({ ...prev, autoAlign: value }))
                    }
                    label={t('за зорями')}
                  />
                </Field>
              </div>

              {detection && (
                <>
                  <Divider label={t('Результат виявлення')} />
                  <StatGrid compact>
                    <Stat label={t('Зірок')} value={detection.stars.length} />
                    <Stat label="FWHM" value={`${fmt(detection.medianFwhm, 2)} px`} hint={t('медіана')} />
                    <Stat label={t('Фон')} value={fmt(detection.background, 1)} />
                    <Stat label={t('Шум')} value={fmt(detection.noise, 2)} />
                  </StatGrid>
                  <Field label={t('Цільова зоря')} hint={t('Найяскравіша або клік на зображенні')}>
                    <SelectInput
                      value={targetIndex}
                      onChange={selectTarget}
                      options={detection.stars.slice(0, 300).map((star, index) => ({
                        value: index,
                        label: `S${star.id} · SNR ${star.snr.toFixed(0)} · FWHM ${star.fwhm.toFixed(2)} px${
                          star.saturated ? ` · ${t('насичена')}` : ''
                        }`,
                      }))}
                    />
                  </Field>
                  {targetStar && (
                    <div className="target-summary">
                      <div>
                        <span>{t('Положення')}</span>
                        <strong className="mono">
                          x {fmt(targetStar.x, 2)} · y {fmt(targetStar.y, 2)}
                        </strong>
                      </div>
                      <div>
                        <span>{t('Потік')}</span>
                        <strong className="mono">{targetStar.flux.toExponential(2)}</strong>
                      </div>
                      <div>
                        <span>{t('Елонгація')}</span>
                        <strong className="mono">{fmt(targetStar.elongation, 2)}</strong>
                      </div>
                    </div>
                  )}
                  <Button
                    icon="play"
                    variant="primary"
                    className="full-width"
                    loading={busy === 'phot'}
                    disabled={Boolean(busy)}
                    onClick={() => void handlePhotometry()}
                  >
                    {phot ? t('Перерахувати фотометрію') : t('Запустити фотометрію')}
                  </Button>
                  {phot && (
                    <div className="phot-summary">
                      <Badge tone="good" dot>
                        {t('апертура')} {fmt(phot.aperturePx, 2)} px
                      </Badge>
                      <Badge tone="accent">
                        {t('кадрів')}: {phot.series[0]?.flux.length ?? 0}
                      </Badge>
                      <Badge tone="violet">
                        {t('діб')}: {fmt(phot.timeSpanDays, 3)}
                      </Badge>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {phot && phot.warnings.length > 0 && (
            <Alert tone="warn" title={t('Попередження фотометрії')}>
              <ul className="alert-list">
                {phot.warnings.map((warning, index) => (
                  <li key={index}>{td(warning)}</li>
                ))}
              </ul>
            </Alert>
          )}
        </StepCard>
      )}

      {phot && lc && (
        <StepCard
          index={3}
          title={t('Крива світла')}
          subtitle={t('Диференціальна фотометрія з ансамблем зірок порівняння та детрендингом.')}
          done={Boolean(lc)}
          aside={
            <div className="step-aside-badges">
              <Badge tone="accent">
                {lc.ensembleIds.length} {t('зірок порівняння')}
              </Badge>
              {lc.detrended && <Badge tone="violet">{t('детрендинг')}</Badge>}
            </div>
          }
        >
          <div className="chart-toolbar">
            <div className="chart-toolbar-meta">
              <strong>S{lc.targetStar.id}</strong>
              <span>
                {t('точок')}: {lcChart?.points ?? 0} · {t('RMS')}: {fmt(lcChart?.rmsPpm, 0)} ppm
              </span>
            </div>
            <div className="chart-toolbar-actions">
              <Button icon="download" variant="ghost" onClick={exportLightCurveCsv}>
                CSV
              </Button>
              <Button
                icon="image"
                variant="ghost"
                onClick={() => void saveChart(lcSvgRef, `${stem}_lightcurve.png`)}
              >
                PNG
              </Button>
            </div>
          </div>

          <Chart
            svgRef={lcSvgRef}
            series={[
              {
                label: t('точки'),
                x: lc.time,
                y: lc.flux,
                color: '#38d9ff',
                kind: 'dots',
                width: 2.6,
                opacity: 0.55,
              },
              ...(lcChart?.binned
                ? [
                    {
                      label: `${t('бінінг')} ${lcOptions.binMinutes.toFixed(0)} ${t('хв')}`,
                      x: lcChart.binned.time,
                      y: lcChart.binned.flux,
                      color: '#fbbf24',
                      kind: 'line' as const,
                      width: 1.6,
                    },
                  ]
                : []),
            ]}
            xLabel={lc.timesAreAbsolute ? 'JD − 2450000' : t('час')}
            yLabel={t('нормований потік')}
            formatX={(value) =>
              lc.timesAreAbsolute ? (value - 2450000).toFixed(2) : value.toFixed(1)
            }
            height={360}
            ariaLabel={t('Крива світла')}
          />

          <StatGrid compact>
            <Stat label={t('Точок')} value={lcChart?.points ?? 0} />
            <Stat label={t('RMS')} value={`${fmt(lcChart?.rmsPpm, 0)} ppm`} hint={t('розсіяння навколо 1')} />
            <Stat
              label={t('Бінований RMS')}
              value={lcChart?.binnedScatter ? `${fmt(lcChart.binnedScatter, 0)} ppm` : '—'}
              hint={lcOptions.binMinutes > 0 ? `${lcOptions.binMinutes} ${t('хв')}` : t('увімкніть бінінг')}
            />
            <Stat label={t('Медіанна похибка')} value={`${fmt(lcChart?.medianErrPpm, 0)} ppm`} />
            <Stat label={t('Зірок порівняння')} value={lc.ensembleIds.length} hint={lc.ensembleIds.slice(0, 8).map((id) => `S${id}`).join(', ')} />
          </StatGrid>

          <div className="form-grid four">
            <Field label={t('Детрендинг')}>
              <SelectInput
                value={lcOptions.detrendOrder}
                onChange={(value) =>
                  setLcOptions((prev) => ({ ...prev, detrendOrder: value as 0 | 1 | 2 }))
                }
                options={[
                  { value: 0, label: t('без тренду') },
                  { value: 1, label: t('лінійний') },
                  { value: 2, label: t('квадратичний') },
                ]}
              />
            </Field>
            <Field label={t('Бінінг, хвилин')} hint={t('0 — без бінінгу')}>
              <NumberInput
                min={0}
                max={180}
                step={1}
                value={lcOptions.binMinutes}
                onChange={(value) => setLcOptions((prev) => ({ ...prev, binMinutes: value }))}
              />
            </Field>
            <Field label={t('Кліпінг, σ')}>
              <RangeInput
                min={2}
                max={8}
                step={0.5}
                value={lcOptions.clipSigma}
                onChange={(value) => setLcOptions((prev) => ({ ...prev, clipSigma: value }))}
                format={(value) => `${value.toFixed(1)}σ`}
              />
            </Field>
            <Field label={t('Відсів змінних, ×')} hint={t('відносно типового RMS')}>
              <RangeInput
                min={1}
                max={6}
                step={0.1}
                value={lcOptions.variableClip}
                onChange={(value) => setLcOptions((prev) => ({ ...prev, variableClip: value }))}
                format={(value) => `${value.toFixed(1)}×`}
              />
            </Field>
          </div>
          <div className="check-row">
            <Checkbox
              checked={lcOptions.useFwhm}
              onChange={(value) => setLcOptions((prev) => ({ ...prev, useFwhm: value }))}
              label="FWHM"
            />
            <Checkbox
              checked={lcOptions.useSky}
              onChange={(value) => setLcOptions((prev) => ({ ...prev, useSky: value }))}
              label={t('небо')}
            />
            <Checkbox
              checked={lcOptions.useAirmass}
              onChange={(value) => setLcOptions((prev) => ({ ...prev, useAirmass: value }))}
              label="airmass"
            />
            <Checkbox
              checked={lcOptions.useCentroid}
              onChange={(value) => setLcOptions((prev) => ({ ...prev, useCentroid: value }))}
              label={t('центроїд')}
            />
          </div>

          {lc.warnings.length > 0 && (
            <Alert tone="warn" title={t('Попередження кривої світла')}>
              <ul className="alert-list">
                {lc.warnings.map((warning, index) => (
                  <li key={index}>{td(warning)}</li>
                ))}
              </ul>
            </Alert>
          )}
        </StepCard>
      )}

      {lc && (
        <StepCard
          index={4}
          title={t('Пошук періоду (BLS)')}
          subtitle={t('Сканування періодів і тривалостей; спектр потужності та найкращі піки.')}
          done={Boolean(bls)}
          aside={bls ? <Badge tone={bls.sde > 6 ? 'good' : 'warn'}>{t('SDE')} {fmt(bls.sde, 2)}</Badge> : undefined}
        >
          <div className="form-grid five">
            <Field label={t('Мін. період, діб')}>
              <NumberInput
                min={0.01}
                step={0.01}
                value={blsOptions.minPeriod}
                onChange={(value) => setBlsOptions((prev) => ({ ...prev, minPeriod: value }))}
              />
            </Field>
            <Field label={t('Макс. період, діб')}>
              <NumberInput
                min={0.05}
                step={0.05}
                value={blsOptions.maxPeriod}
                onChange={(value) => setBlsOptions((prev) => ({ ...prev, maxPeriod: value }))}
              />
            </Field>
            <Field label={t('Точок сітки')}>
              <NumberInput
                min={200}
                max={40000}
                step={100}
                value={blsOptions.nPeriods}
                onChange={(value) => {
                  setBlsPreset('custom');
                  setBlsOptions((prev) => ({ ...prev, nPeriods: Math.round(value) }));
                }}
              />
            </Field>
            <Field label={t('Мін. T₁₄, год')}>
              <NumberInput
                min={0.05}
                max={48}
                step={0.1}
                value={blsOptions.minDurationHours}
                onChange={(value) =>
                  setBlsOptions((prev) => ({ ...prev, minDurationHours: value }))
                }
              />
            </Field>
            <Field label={t('Макс. T₁₄, год')}>
              <NumberInput
                min={0.1}
                max={48}
                step={0.1}
                value={blsOptions.maxDurationHours}
                onChange={(value) =>
                  setBlsOptions((prev) => ({ ...prev, maxDurationHours: value }))
                }
              />
            </Field>
          </div>
          <div className="bls-controls">
            <div className="hint-line">
              {t('Рекомендовано')}: {t('базова лінія')} {fmt(phot?.timeSpanDays, 3)} {t('діб')}
              ; {Math.round(blsOptions.nPeriods).toLocaleString()} × {Math.round(blsOptions.nBins)} {t('бінів')}{' '}
              · {t('оцінка')} ~{fmt((blsOptions.nPeriods * blsOptions.nBins) / 180000, 1)} {t('с')}.
            </div>
            <div className="bls-actions">
              <Field label={t('Пресет BLS')} inline>
                <SelectInput
                  value={blsPreset}
                  onChange={(value) => {
                    if (value === 'custom') setBlsPreset('custom');
                    else applyBlsPreset(value as 'fast' | 'balanced' | 'deep');
                  }}
                  options={[
                    { value: 'fast', label: `${t('Швидко')} · 1.2k` },
                    { value: 'balanced', label: `${t('Збалансовано')} · 3k` },
                    { value: 'deep', label: `${t('Глибоко')} · 8k` },
                    { value: 'custom', label: t('Інше') },
                  ]}
                />
              </Field>
              <Field label={t('Бінів фази')} inline>
                <NumberInput
                  min={80}
                  max={800}
                  step={10}
                  value={blsOptions.nBins}
                  onChange={(value) => {
                    setBlsPreset('custom');
                    setBlsOptions((prev) => ({ ...prev, nBins: Math.round(value) }));
                  }}
                />
              </Field>
              <Button
                icon="chart"
                variant="primary"
                loading={busy === 'bls'}
                disabled={!lc || busy === 'bls' || busy === 'fit'}
                onClick={() => void handleBls()}
              >
                {bls ? t('Перезапустити BLS') : t('Шукати період')}
              </Button>
            </div>
          </div>

          {bls && blsChart && (
            <>
              <Divider label={t('Спектр BLS')} />
              <Chart
                series={[
                  {
                    label: 'BLS',
                    x: blsChart.periods,
                    y: blsChart.scores,
                    color: '#a78bfa',
                    kind: 'line',
                    width: 1.4,
                  },
                ]}
                xLabel={t('період, діб')}
                yLabel="BLS score"
                xScale="log"
                yDomain={[0, Math.max(1, blsChart.max * 1.12)]}
                formatX={(value) => (value < 1 ? value.toFixed(3) : value.toFixed(2))}
                lines={[{ value: bls.best.period, axis: 'x', color: '#38d9ff', dash: '4 4' }]}
                markers={[
                  { x: bls.best.period, y: bls.best.score, color: '#38d9ff', label: t('пік') },
                ]}
                height={320}
                ariaLabel={t('Спектр BLS')}
              />
              <StatGrid compact>
                <Stat label={t('Період')} value={`${fmt(bls.best.period, 6)} ${t('діб')}`} tone="accent" />
                <Stat label={t('Глибина')} value={ppm(bls.best.depth)} />
                <Stat label={t('T₁₄')} value={`${fmt(bls.best.durationDays * 24, 2)} ${t('год')}`} />
                <Stat label="SDE" value={fmt(bls.sde, 2)} tone={bls.sde > 6 ? 'good' : 'warn'} />
                <Stat label={t('Точок')} value={bls.nPoints} />
              </StatGrid>

              <div className="table-title-row">
                <div className="panel-title">{t('Найкращі піки')}</div>
                <span className="muted">{t('Клік на «Обрати» перефітує модель для цього піку.')}</span>
              </div>
              <div className="table-scroll">
                <table className="data-table compact-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('Період, діб')}</th>
                      <th>{t('Глибина')}</th>
                      <th>T₁₄, {t('год')}</th>
                      <th>Score</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {bls.peaks.map((peak, index) => (
                      <tr key={index} className={selectedPeak === index ? 'is-selected' : ''}>
                        <td>{index + 1}</td>
                        <td className="mono">{fmt(peak.period, 6)}</td>
                        <td className="mono">{ppm(peak.depth)}</td>
                        <td className="mono">{fmt(peak.durationDays * 24, 2)}</td>
                        <td className="mono">{fmt(peak.score, 1)}</td>
                        <td>
                          <button type="button" className="text-btn" onClick={() => choosePeak(index)}>
                            {selectedPeak === index ? t('обрано') : t('обрати')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Alert tone="info">
                {t(
                  'Піки на кратних періодах (P/2, 2P) і гармоніках — звичайне явище. Порівняйте форму фазової кривої для кожного піку та перевірте, чи немає пропущених транзитів.',
                )}
              </Alert>
            </>
          )}
        </StepCard>
      )}

      {fit && phaseChart && lc && (
        <StepCard
          index={5}
          title={t('Параметри транзиту')}
          subtitle={t('Трапецієподібна модель, фазово-згортнута крива та похибки параметрів.')}
          done
          aside={
            <div className="step-aside-badges">
              <Badge tone={fit.snr > 7 ? 'good' : 'warn'}>SNRt {fmt(fit.snr, 1)}</Badge>
              <Badge tone="accent">χ²/dof {fmt(fit.chi2 / Math.max(1, fit.dof), 1)}</Badge>
            </div>
          }
        >
          <div className="chart-toolbar">
            <div className="chart-toolbar-meta">
              <strong>
                P = {fmt(fit.params.period, 6)} {t('діб')}
              </strong>
              <span>
                {t('глибина')}: {ppm(fit.params.depth)} · T₁₄: {fmt(fit.params.duration * 24, 2)} {t('год')}
              </span>
            </div>
            <div className="chart-toolbar-actions">
              <Button icon="download" variant="ghost" onClick={exportPhaseCsv}>
                CSV
              </Button>
              <Button
                icon="image"
                variant="ghost"
                onClick={() => void saveChart(phaseSvgRef, `${stem}_phase_folded.png`)}
              >
                PNG
              </Button>
            </div>
          </div>
          <Chart
            svgRef={phaseSvgRef}
            series={[
              {
                label: t('дані'),
                x: phaseChart.phase,
                y: phaseChart.flux,
                color: '#38d9ff',
                kind: 'dots',
                width: 2.6,
                opacity: 0.55,
              },
              {
                label: t('модель'),
                x: phaseChart.phase,
                y: phaseChart.model,
                color: '#fbbf24',
                kind: 'line',
                width: 2,
              },
            ]}
            xLabel={t('фаза')}
            yLabel={t('нормований потік')}
            xDomain={[-0.5, 0.5]}
            yDomain={phaseChart.yDomain}
            formatX={(value) => value.toFixed(2)}
            lines={[{ value: 1, axis: 'y', color: '#64748b', dash: '2 4' }]}
            height={340}
            ariaLabel={t('Фазова крива транзиту')}
          />

          <div className="split-layout params-layout">
            <div className="split-main">
              <div className="panel-title">{t('Параметри моделі')}</div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('Параметр')}</th>
                      <th>{t('Значення')}</th>
                      <th>{t('Похибка')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{t('Період')} P, {t('діб')}</td>
                      <td className="mono">{fmt(fit.params.period, 6)}</td>
                      <td className="mono">± {fmt(fit.errors.period, 6)}</td>
                    </tr>
                    <tr>
                      <td>Epoch T₀, JD</td>
                      <td className="mono">{fmt(fit.params.t0, 6)}</td>
                      <td className="mono">± {fmt(fit.errors.t0, 6)}</td>
                    </tr>
                    <tr>
                      <td>{t('Глибина')}, ppm</td>
                      <td className="mono">{ppm(fit.params.depth)}</td>
                      <td className="mono">± {ppm(fit.errors.depth)}</td>
                    </tr>
                    <tr>
                      <td>T₁₄, {t('год')}</td>
                      <td className="mono">{fmt(fit.params.duration * 24, 3)}</td>
                      <td className="mono">± {fmt((fit.errors.duration ?? NaN) * 24, 3)}</td>
                    </tr>
                    <tr>
                      <td>T₁₂, {t('год')}</td>
                      <td className="mono">{fmt(fit.params.ingress * 24, 3)}</td>
                      <td className="mono">± {fmt((fit.errors.ingress ?? NaN) * 24, 3)}</td>
                    </tr>
                    <tr>
                      <td>SNRt</td>
                      <td className="mono">{fmt(fit.snr, 2)}</td>
                      <td className="mono">—</td>
                    </tr>
                    <tr>
                      <td>χ² / dof</td>
                      <td className="mono">{fmt(fit.chi2, 1)} / {fit.dof}</td>
                      <td className="mono">—</td>
                    </tr>
                    <tr>
                      <td>RMS, ppm</td>
                      <td className="mono">{fmt(fit.rms, 0)}</td>
                      <td className="mono">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="panel-title with-top">{t('Транзитні події')}</div>
              <div className="table-scroll">
                <table className="data-table compact-table">
                  <thead>
                    <tr>
                      <th>Epoch</th>
                      <th>{t('Центр, JD')}</th>
                      <th>{t('Глибина')}</th>
                      <th>{t('Похибка')}</th>
                      <th>N</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fit.events.map((event) => (
                      <tr key={event.epoch}>
                        <td>{event.epoch}</td>
                        <td className="mono">{fmt(event.center, 5)}</td>
                        <td className="mono">{ppm(event.depth)}</td>
                        <td className="mono">± {ppm(event.error)}</td>
                        <td>{event.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="split-side">
              <div className="panel-title">{t('Форма транзиту')}</div>
              <StatGrid compact>
                <Stat label="T₀" value={fmt(fit.params.t0, 4)} hint="JD" />
                <Stat label={t('Глибина')} value={ppm(fit.params.depth)} />
                <Stat label="T₁₄" value={`${fmt(fit.params.duration * 24, 2)} ${t('год')}`} />
                <Stat label="T₁₂/T₁₄" value={fmt(fit.params.ingress / Math.max(fit.params.duration, 1e-9), 2)} />
              </StatGrid>
              {fit.periodAtBoundary && (
                <Alert tone="warn" title={t('Період на межі пошуку')}>
                  {t('Розширте діапазон періодів і перезапустіть BLS.')}
                </Alert>
              )}
              {fit.warnings.length > 0 && (
                <Alert tone="warn" title={t('Попередження фіту')}>
                  <ul className="alert-list">
                    {fit.warnings.map((warning, index) => (
                      <li key={index}>{td(warning)}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              <div className="export-block">
                <div className="panel-title">{t('Експорт')}</div>
                <div className="export-buttons">
                  <Button
                    icon="download"
                    variant="primary"
                    disabled={!reportReady}
                    onClick={exportReport}
                  >
                    {t('Звіт Markdown')}
                  </Button>
                  <Button icon="download" variant="secondary" disabled={!reportReady} onClick={exportJson}>
                    JSON
                  </Button>
                </div>
                <p className="muted small">
                  {t('Звіт містить параметри, події, веттинг і попередження.')}
                </p>
              </div>
            </div>
          </div>
        </StepCard>
      )}

      {vet && (
        <StepCard
          index={6}
          title={t('Веттинг кандидата')}
          subtitle={t('Автоматичні перевірки на типові хибнопозитиви.')}
          done
          aside={<Badge tone={verTone(vet.verdict)}>{verdictLabel(vet.verdict, lang)}</Badge>}
        >
          <div className={`verdict-card verdict-${verTone(vet.verdict)}`}>
            <div className="verdict-score">
              <span>{Math.round(vet.score)}</span>
              <small>/ 100</small>
            </div>
            <div className="verdict-copy">
              <h3>{verdictLabel(vet.verdict, lang)}</h3>
              <p>
                {t(
                  'Оцінка враховує SNRt, кількість подій і кількість проблемних перевірок. Це не ймовірність і не підтвердження планети.',
                )}
              </p>
              <div className="verdict-bar">
                <span style={{ width: `${Math.max(2, vet.score)}%` }} />
              </div>
            </div>
          </div>

          <StatGrid compact>
            <Stat
              label={t('Odd–even')}
              value={Number.isFinite(vet.oddEven.sigma) ? `${fmt(vet.oddEven.sigma, 1)}σ` : '—'}
              hint={`${vet.oddEven.nOdd} / ${vet.oddEven.nEven}`}
              tone={Number.isFinite(vet.oddEven.sigma) && vet.oddEven.sigma > 3 ? 'bad' : 'good'}
            />
            <Stat
              label={t('Вторинний мінімум')}
              value={Number.isFinite(vet.secondary.sigma) ? `${fmt(vet.secondary.sigma, 1)}σ` : '—'}
              hint={ppm(vet.secondary.depth)}
              tone={Number.isFinite(vet.secondary.sigma) && vet.secondary.sigma > 3 ? 'bad' : 'good'}
            />
            <Stat
              label={t('Зсув центроїда')}
              value={Number.isFinite(vet.centroid.sigma) ? `${fmt(vet.centroid.sigma, 1)}σ` : '—'}
              hint={`(${fmt(vet.centroid.dx, 2)}, ${fmt(vet.centroid.dy, 2)}) px`}
              tone={Number.isFinite(vet.centroid.sigma) && vet.centroid.sigma > 3 ? 'bad' : 'good'}
            />
            <Stat
              label={t('Red noise')}
              value={Number.isFinite(vet.redNoise) ? fmt(vet.redNoise, 2) : '—'}
              hint={t('біновані залишки / фотонний')}
              tone={Number.isFinite(vet.redNoise) && vet.redNoise > 2 ? 'bad' : 'good'}
            />
            <Stat label="T₁₂/T₁₄" value={fmt(vet.shapeRatio, 2)} hint={t('U-подібність')} />
          </StatGrid>

          <div className="flag-grid">
            {vet.flags.map((flag) => (
              <div key={flag.id} className={`flag flag-${flag.severity}`}>
                <span className="flag-icon">
                  <Icon
                    name={flag.severity === 'good' ? 'check' : flag.severity === 'bad' || flag.severity === 'warn' ? 'warn' : 'info'}
                    size={16}
                  />
                </span>
                <div className="flag-copy">
                  <div className="flag-head">
                    <strong>{flag.title}</strong>
                    {flag.value && <Badge tone={flag.severity === 'bad' ? 'bad' : flag.severity === 'warn' ? 'warn' : flag.severity === 'good' ? 'good' : 'neutral'}>{flag.value}</Badge>}
                  </div>
                  <p>{flag.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <Alert tone="info" title={t('Що далі?')}>
            {t(
              'Перевірте кандидата на інших епохах, виключіть зоряні плями та пульсації за допомогою фотометрії в інших фільтрах і підтвердьте період спектроскопією або архівними даними.',
            )}
          </Alert>
          <div className="export-buttons">
            <Button icon="download" variant="primary" onClick={exportReport}>
              {t('Завантажити звіт Markdown')}
            </Button>
            <Button icon="download" variant="secondary" onClick={exportJson}>
              {t('Завантажити JSON')}
            </Button>
          </div>
        </StepCard>
      )}

      {!dataset && (
        <EmptyState icon="spark" title={t('Конвеєр чекає на кадри')}>
          {t('Завантажте FITS або зображення вище, щоб почати. Усе виконується локально.')}
        </EmptyState>
      )}
    </div>
  );
}

function verTone(verdict: VettingResult['verdict']): 'good' | 'accent' | 'warn' | 'bad' | 'neutral' {
  switch (verdict) {
    case 'strong':
      return 'good';
    case 'candidate':
      return 'accent';
    case 'weak':
      return 'warn';
    case 'false-positive':
      return 'bad';
    default:
      return 'neutral';
  }
}
