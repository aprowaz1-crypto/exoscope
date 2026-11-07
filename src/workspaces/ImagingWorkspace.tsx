import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ImagingResult,
  ImagingSettings,
  ProgressInfo,
} from '../types';
import { useDataset, errorMessage } from '../hooks/useDataset';
import { useI18n } from '../i18n';
import { findBrightestCentroid, runAdi } from '../lib/adi';
import {
  Alert,
  Badge,
  Button,
  Card,
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
  contrastCurveCsv,
  downloadJson,
  downloadText,
  formatValue,
  imagingCandidatesCsv,
  imagingJson,
  imagingReportMarkdown,
  safeFileStem,
} from '../lib/export';
import type { DemoSignal } from '../App';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 24));

const fmt = (value: number | undefined | null, digits = 3): string =>
  formatValue(value ?? NaN, digits);

const numOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

type ImageView = 'combined' | 'snr' | 'reference';

function StepCard({
  index,
  title,
  subtitle,
  done,
  aside,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  done?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="step-card">
      <StepHeader index={index} title={title} subtitle={subtitle} done={done} aside={aside} />
      <div className="step-body">{children}</div>
    </section>
  );
}

const initialSettings: ImagingSettings = {
  center: null,
  angleMode: 'header',
  manualStart: 0,
  manualStep: 1.5,
  minSeparation: 8,
  maxSeparation: 100,
  threshold: 5,
  pixelScale: 0.05,
  maxFrames: 24,
};

export function ImagingWorkspace({ demoSignal }: { demoSignal: DemoSignal | null }) {
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
  } = useDataset('imaging');

  const [settings, setSettings] = useState<ImagingSettings>(initialSettings);
  const [result, setResult] = useState<ImagingResult | null>(null);
  const [imageView, setImageView] = useState<ImageView>('combined');
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | 'adi'>(null);
  const [taskProgress, setTaskProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const processedDemo = useRef(0);

  const datasetId = dataset?.id ?? null;

  useEffect(() => {
    if (!dataset) return;
    const first = dataset.frames[0];
    const width = first.width;
    const height = first.height;
    const hint = dataset.centerHint;
    const brightest = hint ?? (() => {
      const found = findBrightestCentroid(first);
      return { x: found.x, y: found.y };
    })();
    const headerAngles: number[] = [];
    for (const frame of dataset.frames) {
      if (Number.isFinite(frame.meta.parang)) headerAngles.push(frame.meta.parang!);
    }
    const span =
      headerAngles.length > 1
        ? Math.max(...headerAngles) - Math.min(...headerAngles)
        : 0;
    const step =
      headerAngles.length > 1
        ? (headerAngles[headerAngles.length - 1] - headerAngles[0]) /
          (headerAngles.length - 1)
        : 1.5;
    setSettings({
      center: { x: brightest.x, y: brightest.y },
      angleMode: span > 0.5 ? 'header' : 'none',
      manualStart: headerAngles.length ? headerAngles[0] : 0,
      manualStep: Number.isFinite(step) && step !== 0 ? step : 1.5,
      minSeparation: Math.max(5, Math.round(Math.min(width, height) * 0.035)),
      maxSeparation: Math.max(
        12,
        Math.round(Math.min(width, height) / 2 - Math.max(4, Math.min(width, height) * 0.025)),
      ),
      threshold: 5,
      pixelScale:
        dataset.pixelScale ??
        numOr(first.meta.pixelScale, 1),
      maxFrames: Math.min(48, Math.max(3, dataset.frames.length)),
    });
    setResult(null);
    setSelectedCandidate(null);
    setImageView('combined');
    setBusy(null);
    setTaskProgress(null);
    setError(null);
  }, [datasetId]);

  useEffect(() => {
    if (demoSignal && demoSignal.nonce !== processedDemo.current) {
      processedDemo.current = demoSignal.nonce;
      void loadDemo();
    }
  }, [demoSignal, loadDemo]);

  const referenceFrame = dataset?.frames[0] ?? null;

  const rotationInfo = useMemo(() => {
    if (!dataset) return null;
    const angles = dataset.frames
      .map((frame) => frame.meta.parang)
      .filter((value): value is number => Number.isFinite(value));
    if (angles.length < 2) return null;
    const min = Math.min(...angles);
    const max = Math.max(...angles);
    return { min, max, span: max - min, count: angles.length };
  }, [dataset]);

  const center = settings.center;

  const previewMarkers = useMemo(
    () =>
      center
        ? [{ x: center.x, y: center.y, kind: 'center' as const, label: t('центр') }]
        : [],
    [center, t],
  );

  const imageState = useMemo(() => {
    if (!result) return null;
    if (imageView === 'combined') {
      return { data: result.combined, low: 5, high: 99.85, palette: 'cool' as const };
    }
    if (imageView === 'snr') {
      return { data: result.snrMap, low: 50, high: 99.9, palette: 'gray' as const };
    }
    return { data: result.reference, low: 0.5, high: 99.6, palette: 'inferno' as const };
  }, [result, imageView]);

  const resultMarkers = useMemo(() => {
    if (!result) return [];
    const markers: Array<{
      x: number;
      y: number;
      kind: 'center' | 'candidate' | 'target';
      label?: string;
      color?: string;
    }> = [
      {
        x: result.center.x,
        y: result.center.y,
        kind: 'center',
        label: t('центр'),
      },
    ];
    if (imageView !== 'reference') {
      for (const candidate of result.candidates) {
        const selected = candidate.id === selectedCandidate;
        markers.push({
          x: candidate.x,
          y: candidate.y,
          kind: selected ? 'target' : 'candidate',
          label: `C${candidate.id}`,
          color: selected ? '#fb7185' : undefined,
        });
      }
    }
    return markers;
  }, [result, imageView, selectedCandidate, t]);

  const contrastChart = useMemo(() => {
    if (!result || result.contrastCurve.length < 2) return null;
    const sep = new Float64Array(result.contrastCurve.length);
    const five = new Float64Array(result.contrastCurve.length);
    const one = new Float64Array(result.contrastCurve.length);
    for (let i = 0; i < result.contrastCurve.length; i++) {
      const point = result.contrastCurve[i];
      sep[i] = point.sepArcsec;
      five[i] = point.contrast5Mag;
      one[i] = -2.5 * Math.log10(Math.max(point.contrast1, 1e-15));
    }
    return { sep, five, one };
  }, [result]);

  const midContrast = useMemo(() => {
    if (!result || result.contrastCurve.length < 1) return null;
    return result.contrastCurve[Math.floor(result.contrastCurve.length / 2)];
  }, [result]);

  const stem = safeFileStem(dataset?.name ?? 'exoscope');

  async function handleRun() {
    if (!dataset) return;
    if (!settings.center) {
      setError(t('Спочатку виберіть центр зорі на зображенні.'));
      return;
    }
    if (!(settings.maxSeparation > settings.minSeparation + 2)) {
      setError(t('Максимальна відстань має бути більшою за мінімальну.'));
      return;
    }
    setBusy('adi');
    setError(null);
    setResult(null);
    setSelectedCandidate(null);
    setTaskProgress({ label: t('Запуск ADI/RDI'), value: 0 });
    try {
      await tick();
      const runResult = await runAdi({
        frames: dataset.frames,
        settings: {
          ...settings,
          center: settings.center,
          pixelScale: settings.pixelScale > 0 ? settings.pixelScale : 1,
          maxFrames: Math.max(3, Math.round(settings.maxFrames)),
        },
        pixelScale: settings.pixelScale > 0 ? settings.pixelScale : 1,
        onProgress: (value, label) => {
          setTaskProgress({ label: t(label), value });
        },
      });
      setResult(runResult);
      setImageView('combined');
      setSelectedCandidate(runResult.candidates[0]?.id ?? null);
      setTaskProgress({ label: t('Готово'), value: 1 });
    } catch (err) {
      setError(errorMessage(err));
      setTaskProgress(null);
    } finally {
      setBusy(null);
    }
  }

  function autoCenter() {
    if (!referenceFrame) return;
    const found = findBrightestCentroid(referenceFrame);
    setSettings((prev) => ({ ...prev, center: { x: found.x, y: found.y } }));
  }

  function setAngleMode(mode: ImagingSettings['angleMode']) {
    setSettings((prev) => {
      if (mode === 'manual') {
        if (rotationInfo) {
          return {
            ...prev,
            angleMode: mode,
            manualStart: rotationInfo.min,
            manualStep:
              rotationInfo.count > 1
                ? (rotationInfo.max - rotationInfo.min) / (rotationInfo.count - 1)
                : prev.manualStep,
          };
        }
        return { ...prev, angleMode: mode };
      }
      return { ...prev, angleMode: mode };
    });
  }

  function exportReport() {
    if (!dataset || !result) return;
    downloadText(
      `${stem}_imaging_report.md`,
      imagingReportMarkdown({ dataset, result, lang }),
      'text/markdown;charset=utf-8',
    );
  }

  function exportJson() {
    if (!dataset || !result) return;
    downloadJson(`${stem}_imaging.json`, imagingJson({ dataset, result, lang }));
  }

  const activeProgress = loaderProgress ?? taskProgress;

  return (
    <div className="page workspace-page">
      <header className="workspace-head">
        <div>
          <span className="eyebrow">
            <Icon name="telescope" size={14} /> {t('Пряме зображення')}
          </span>
          <h1>{t('Пошук екзопланет прямим зображенням')}</h1>
          <p>
            {t(
              'Висококонтрастна обробка серії кадрів: вирівнювання, віднімання PSF, обертання поля ADI, карта SNR, крива контрастності та кандидати-компаньйони.',
            )}
          </p>
        </div>
        <div className="workspace-badges">
          <Badge tone="violet">{t('ADI · RDI')}</Badge>
          <Badge tone="accent">{t('5σ контраст')}</Badge>
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
              accept=".fits,.fit,.fts,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
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
      {loaderBusy && activeProgress && (
        <div className="task-banner">
          <Progress
            value={activeProgress.value}
            label={activeProgress.label}
            detail={activeProgress.detail}
          />
        </div>
      )}
      {busy && taskProgress && (
        <div className="task-banner">
          <Progress value={taskProgress.value} label={taskProgress.label} detail={taskProgress.detail} />
        </div>
      )}

      {!dataset && (
        <Card
          title={t('Почніть із серії кадрів')}
          icon="upload"
          subtitle={t('Потрібна серія з кількох кадрів однієї зорі з обертанням поля або зміною PSF.')}
        >
          <UploadZone onFiles={(files) => void loadFiles(files)} disabled={Boolean(loaderBusy)} />
          <div className="start-demo">
            <div>
              <strong>{t('Немає даних під рукою?')}</strong>
              <p>
                {t(
                  'Згенеруйте синтетичну ADI-серію: 28 кадрів 256×256, обертання поля 42°, планета з контрастом 4×10⁻⁴.',
                )}
              </p>
            </div>
            <Button
              icon="play"
              variant="primary"
              loading={loaderBusy === 'demo'}
              onClick={() => void loadDemo()}
            >
              {t('Завантажити демо-ADI')}
            </Button>
          </div>
        </Card>
      )}

      {dataset && (
        <StepCard
          index={1}
          title={t('Геометрія поля')}
          subtitle={t('Перевірте центр зорі, обертання поля та орієнтацію кадрів.')}
          done={Boolean(result)}
          aside={
            <Badge tone={rotationInfo && rotationInfo.span >= 10 ? 'good' : 'warn'} dot>
              {rotationInfo
                ? `${t('обертання')} ${fmt(rotationInfo.span, 1)}°`
                : t('немає PARANG')}
            </Badge>
          }
        >
          <div className="split-layout">
            <div className="split-main">
              {referenceFrame && (
                <ImageCanvas
                  data={referenceFrame.data}
                  width={referenceFrame.width}
                  height={referenceFrame.height}
                  markers={previewMarkers}
                  onClick={(x, y) => setSettings((prev) => ({ ...prev, center: { x, y } }))}
                  ariaLabel={t('Референсний кадр: виберіть центр зорі')}
                  maxHeight={520}
                />
              )}
              <p className="caption">
                {t(
                  'Клікніть на центр зорі, щоб задати точку відліку для ADI. За замовчуванням використовується найяскравіша зоря або підказка набору.',
                )}
              </p>
            </div>
            <div className="split-side">
              <div className="panel-title">{t('Центр зорі')}</div>
              <div className="form-grid two">
                <Field label="X, px">
                  <NumberInput
                    value={center?.x ?? 0}
                    min={0}
                    max={referenceFrame ? referenceFrame.width - 1 : 0}
                    step={0.5}
                    onChange={(value) =>
                      setSettings((prev) => ({
                        ...prev,
                        center: { x: value, y: prev.center?.y ?? 0 },
                      }))
                    }
                  />
                </Field>
                <Field label="Y, px">
                  <NumberInput
                    value={center?.y ?? 0}
                    min={0}
                    max={referenceFrame ? referenceFrame.height - 1 : 0}
                    step={0.5}
                    onChange={(value) =>
                      setSettings((prev) => ({
                        ...prev,
                        center: { x: prev.center?.x ?? 0, y: value },
                      }))
                    }
                  />
                </Field>
              </div>
              <Button icon="target" variant="secondary" onClick={autoCenter} className="full-width">
                {t('Центрувати на найяскравішій зорі')}
              </Button>

              <Divider label={t('Обертання поля')} />
              <Field
                label={t('Джерело кутів')}
                hint={t('PARANG з FITS-заголовків або ручний крок між кадрами')}
              >
                <SelectInput
                  value={settings.angleMode}
                  onChange={setAngleMode}
                  options={[
                    { value: 'header', label: t('PARANG із заголовків') },
                    { value: 'manual', label: t('Ручні кути') },
                    { value: 'none', label: t('Без обертання (RDI)') },
                  ]}
                />
              </Field>
              {settings.angleMode === 'manual' && (
                <div className="form-grid two">
                  <Field label={t('Початковий кут, °')}>
                    <NumberInput
                      value={settings.manualStart}
                      step={0.1}
                      onChange={(value) =>
                        setSettings((prev) => ({ ...prev, manualStart: value }))
                      }
                    />
                  </Field>
                  <Field label={t('Крок, °/кадр')}>
                    <NumberInput
                      value={settings.manualStep}
                      step={0.1}
                      onChange={(value) =>
                        setSettings((prev) => ({ ...prev, manualStep: value }))
                      }
                    />
                  </Field>
                </div>
              )}
              {settings.angleMode === 'header' && rotationInfo && (
                <StatGrid compact>
                  <Stat label={t('Мін. кут')} value={`${fmt(rotationInfo.min, 2)}°`} />
                  <Stat label={t('Макс. кут')} value={`${fmt(rotationInfo.max, 2)}°`} />
                  <Stat
                    label={t('Розмах')}
                    value={`${fmt(rotationInfo.span, 2)}°`}
                    tone={rotationInfo.span >= 10 ? 'good' : 'warn'}
                  />
                </StatGrid>
              )}
              {rotationInfo && rotationInfo.span < 10 && (
                <Alert tone="warn" title={t('Мале обертання поля')}>
                  {t(
                    'Для ADI бажано понад 10° обертання. Інакше слабкі джерела можуть залишитися у залишках PSF.',
                  )}
                </Alert>
              )}
            </div>
          </div>

          {dataset.demo && dataset.notes && (
            <Alert tone="info" title={t('Демонстраційний набір')}>
              {dataset.notes}
            </Alert>
          )}
          {datasetWarnings.length > 0 && (
            <Alert tone="warn" title={t('Попередження читання файлів')} onClose={dismissWarnings}>
              <ul className="alert-list">
                {datasetWarnings.map((warning, index) => (
                  <li key={index}>{td(warning)}</li>
                ))}
              </ul>
            </Alert>
          )}
        </StepCard>
      )}

      {dataset && (
        <StepCard
          index={2}
          title={t('Параметри ADI/RDI')}
          subtitle={t('Налаштуйте відсікання, шумову модель і поріг виявлення кандидатів.')}
          done={Boolean(result)}
          aside={result ? <Badge tone="good" dot>{t('обробка завершена')}</Badge> : undefined}
        >
          <div className="form-grid five">
            <Field label={t('Піксельна шкала, ″/px')} hint={t('з FITS або вручну')}>
              <NumberInput
                value={settings.pixelScale}
                min={0.0001}
                max={60}
                step={0.001}
                onChange={(value) =>
                  setSettings((prev) => ({ ...prev, pixelScale: value }))
                }
              />
            </Field>
            <Field label={t('Кадрів максимум')} hint={t('рівномірно з серії')}>
              <NumberInput
                value={settings.maxFrames}
                min={3}
                max={dataset.frames.length}
                step={1}
                onChange={(value) =>
                  setSettings((prev) => ({ ...prev, maxFrames: Math.round(value) }))
                }
              />
            </Field>
            <Field label={t('Мін. відстань, px')} hint={t('внутрішня межа пошуку')}>
              <NumberInput
                value={settings.minSeparation}
                min={2}
                max={100}
                step={1}
                onChange={(value) =>
                  setSettings((prev) => ({ ...prev, minSeparation: Math.round(value) }))
                }
              />
            </Field>
            <Field
              label={t('Макс. відстань, px')}
              hint={`${fmt(settings.maxSeparation * settings.pixelScale, 2)}″`}
            >
              <NumberInput
                value={settings.maxSeparation}
                min={5}
                max={Math.floor(Math.min(dataset.frames[0].width, dataset.frames[0].height) / 2) - 1}
                step={1}
                onChange={(value) =>
                  setSettings((prev) => ({ ...prev, maxSeparation: Math.round(value) }))
                }
              />
            </Field>
            <Field label={t('Поріг SNR')} hint={t('для кандидатів')}>
              <RangeInput
                min={2}
                max={12}
                step={0.5}
                value={settings.threshold}
                onChange={(value) => setSettings((prev) => ({ ...prev, threshold: value }))}
                format={(value) => `${value.toFixed(1)}σ`}
              />
            </Field>
          </div>

          <div className="bls-controls">
            <div className="hint-line">
              {t(
                'Значення шуму оцінюються радіальними кільцями у комбінованому зображенні. Поріг 5σ — типовий для попереднього відбору; слабші кандидати потребують ручної перевірки.',
              )}
            </div>
            <div className="bls-actions">
              <Button
                icon="play"
                variant="primary"
                loading={busy === 'adi'}
                disabled={Boolean(busy) || Boolean(loaderBusy)}
                onClick={() => void handleRun()}
              >
                {result ? t('Перезапустити ADI') : t('Запустити ADI/RDI')}
              </Button>
            </div>
          </div>
        </StepCard>
      )}

      {result && imageState && (
        <StepCard
          index={3}
          title={t('Зображення та кандидати')}
          subtitle={t('PSF-віднімання, карта SNR і автоматичний пошук точкових джерел.')}
          done
          aside={
            <Badge tone={result.candidates.length ? 'good' : 'warn'}>
              {result.candidates.length} {t('кандидатів')}
            </Badge>
          }
        >
          <StatGrid>
            <Stat label={t('Використано кадрів')} value={`${result.framesUsed} / ${dataset?.frames.length ?? 0}`} />
            <Stat
              label={t('Обертання поля')}
              value={`${fmt(result.totalRotation, 1)}°`}
              hint={t(result.angleSource)}
              tone={result.totalRotation >= 10 ? 'good' : 'warn'}
            />
            <Stat label={t('Пік зорі')} value={result.starPeak.toExponential(2)} hint="ADU" />
            <Stat
              label={t('5σ контраст')}
              value={midContrast ? `${fmt(midContrast.contrast5Mag, 1)} mag` : '—'}
              hint={
                midContrast
                  ? `${fmt(midContrast.sepArcsec, 2)}″ · ${midContrast.contrast5.toExponential(1)}`
                  : undefined
              }
            />
            <Stat
              label={t('Кандидатів')}
              value={result.candidates.length}
              hint={t('вище порогу')}
              tone={result.candidates.length ? 'good' : undefined}
            />
            <Stat label={t('Час обробки')} value={`${fmt(result.elapsedMs / 1000, 1)} ${t('с')}`} />
          </StatGrid>

          <div className="view-toolbar">
            <div className="segmented" role="group" aria-label={t('Зображення')}>
              {(
                [
                  ['combined', t('Комбіноване')],
                  ['snr', t('Карта SNR')],
                  ['reference', t('Референс PSF')],
                ] as Array<[ImageView, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={imageView === id ? 'is-active' : ''}
                  onClick={() => setImageView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="view-legend">
              <span>
                <i className="dot dot-center" /> {t('центр')}
              </span>
              <span>
                <i className="dot dot-candidate" /> {t('кандидат')}
              </span>
            </div>
          </div>

          <ImageCanvas
            key={imageView}
            data={imageState.data}
            width={result.width}
            height={result.height}
            markers={resultMarkers}
            defaultLow={imageState.low}
            defaultHigh={imageState.high}
            defaultPalette={imageState.palette}
            maxHeight={560}
            ariaLabel={t('Результат ADI: {view}', {
              view:
                imageView === 'combined'
                  ? t('комбіноване зображення')
                  : imageView === 'snr'
                    ? t('карта SNR')
                    : t('референсна PSF'),
            })}
            downloadName={`${stem}_adi_${imageView}.png`}
          />
          <p className="caption">
            {imageView === 'combined' &&
              t(
                'Комбіноване зображення після віднімання медіанної PSF та обертання залишків у спільну систему координат. Планета додається когерентно, статичні спекли — ні.',
              )}
            {imageView === 'snr' &&
              t(
                'Карта SNR: залишок, поділений на локальну MAD-оцінку шуму в радіальному кільці. Шукайте піки поза межами центральної PSF.',
              )}
            {imageView === 'reference' &&
              t(
                'Медіанний стек вирівняних кадрів. Це референсна PSF, яка віднімається від кожного кадру; центральна зоря тут не віднімається.',
              )}
          </p>

          <Divider label={t('Кандидати')} />
          {result.candidates.length ? (
            <div className="table-scroll">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('X, px')}</th>
                    <th>{t('Y, px')}</th>
                    <th>{t('Відстань, px')}</th>
                    <th>{t('Відстань, ″')}</th>
                    <th>PA, °</th>
                    <th>SNR</th>
                    <th>{t('Контраст')}</th>
                    <th>Δmag</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((candidate) => (
                    <tr
                      key={candidate.id}
                      className={selectedCandidate === candidate.id ? 'is-selected' : ''}
                    >
                      <td>C{candidate.id}</td>
                      <td className="mono">{fmt(candidate.x, 2)}</td>
                      <td className="mono">{fmt(candidate.y, 2)}</td>
                      <td className="mono">{fmt(candidate.sepPx, 2)}</td>
                      <td className="mono">{fmt(candidate.sepArcsec, 3)}</td>
                      <td className="mono">{fmt(candidate.pa, 1)}</td>
                      <td className="mono">{fmt(candidate.snr, 2)}</td>
                      <td className="mono">{candidate.contrast.toExponential(2)}</td>
                      <td className="mono">{fmt(candidate.contrastMag, 2)}</td>
                      <td>
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() => {
                            setSelectedCandidate(candidate.id);
                            if (imageView === 'reference') setImageView('combined');
                          }}
                        >
                          {selectedCandidate === candidate.id ? t('обрано') : t('обрати')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="target" title={t('Кандидатів вище порогу не знайдено')}>
              {t(
                'Спробуйте знизити поріг SNR, зменшити мінімальну відстань або перевірити кути обертання поля.',
              )}
            </EmptyState>
          )}

          {result.warnings.length > 0 && (
            <Alert tone="warn" title={t('Попередження ADI')}>
              <ul className="alert-list">
                {result.warnings.map((warning, index) => (
                  <li key={index}>{td(warning)}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="export-block">
            <div className="panel-title">{t('Експорт')}</div>
            <div className="export-buttons">
              <Button icon="download" variant="primary" onClick={exportReport}>
                {t('Звіт Markdown')}
              </Button>
              <Button icon="download" variant="secondary" onClick={exportJson}>
                JSON
              </Button>
              <Button
                icon="download"
                variant="ghost"
                onClick={() =>
                  downloadText(
                    `${stem}_candidates.csv`,
                    imagingCandidatesCsv(result),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                {t('Кандидати CSV')}
              </Button>
              <Button
                icon="download"
                variant="ghost"
                onClick={() =>
                  downloadText(
                    `${stem}_contrast.csv`,
                    contrastCurveCsv(result),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                {t('Контраст CSV')}
              </Button>
            </div>
          </div>
        </StepCard>
      )}

      {result && contrastChart && (
        <StepCard
          index={4}
          title={t('Крива контрастності')}
          subtitle={t('Граничний контраст 1σ і 5σ залежно від відстані від зорі.')}
          done
          aside={<Badge tone="accent">{t('Δmag')}</Badge>}
        >
          <Chart
            series={[
              {
                label: '5σ Δmag',
                x: contrastChart.sep,
                y: contrastChart.five,
                color: '#fbbf24',
                kind: 'line',
                width: 1.8,
              },
              {
                label: '1σ Δmag',
                x: contrastChart.sep,
                y: contrastChart.one,
                color: '#38d9ff',
                kind: 'line',
                width: 1.3,
                dash: '4 4',
              },
            ]}
            xLabel={t('відстань, кутових секунд')}
            yLabel={t('граничний Δmag')}
            formatX={(value) => value.toFixed(2)}
            formatY={(value) => value.toFixed(1)}
            height={340}
            ariaLabel={t('Крива контрастності ADI')}
          />
          <p className="caption">
            {t(
              'Вища крива означає кращу чутливість: на даній відстані можна виявити джерело з таким Δmag. Розрахунок спирається на радіальну MAD-оцінку шуму; він не враховує систематику PSF і помилки кутів.',
            )}
          </p>
        </StepCard>
      )}

      {dataset && (
        <Alert tone="info" title={t('Наукове застереження')}>
          {t(
            'Кандидат у прямому зображенні — це пік у залишках, а не підтверджена планета. Потрібні повторні епохи, кілька фільтрів, астрометрія та перевірка на інструментальні артефакти (спекли, дифракційні піки, стовпи детектора).',
          )}
        </Alert>
      )}

      {!dataset && (
        <EmptyState icon="telescope" title={t('Конвеєр чекає на серію кадрів')}>
          {t('Завантажте FITS або зображення вище, щоб почати. Усе виконується локально.')}
        </EmptyState>
      )}
    </div>
  );
}
