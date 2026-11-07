export type Language = 'uk' | 'en';

export interface FitsCard {
  value: string | number | boolean | null;
  comment: string;
}

export interface FrameMeta {
  dateObs?: string;
  jd?: number;
  jdKind?: 'BJD_TDB' | 'BJD' | 'HJD' | 'JD' | 'MJD' | 'DATE-OBS' | 'FALLBACK';
  exposure?: number;
  filter?: string;
  airmass?: number;
  parang?: number;
  pixelScale?: number;
  gain?: number;
  readNoise?: number;
  saturate?: number;
  object?: string;
  telescope?: string;
  instrument?: string;
}

export interface Frame {
  id: string;
  name: string;
  width: number;
  height: number;
  data: Float32Array;
  header: Record<string, FitsCard>;
  meta: FrameMeta;
  binFactor?: number;
}

export interface Dataset {
  id: string;
  name: string;
  kind: 'transit' | 'imaging' | 'generic';
  frames: Frame[];
  pixelScale?: number;
  demo?: 'transit' | 'imaging';
  notes?: string;
  targetHint?: { x: number; y: number };
  centerHint?: { x: number; y: number };
}

export interface Star {
  id: number;
  x: number;
  y: number;
  flux: number;
  peak: number;
  fwhm: number;
  snr: number;
  area: number;
  elongation: number;
  saturated: boolean;
}

export interface DetectionResult {
  stars: Star[];
  background: number;
  noise: number;
  medianFwhm: number;
  threshold: number;
}

export interface FrameTransform {
  a: number;
  b: number;
  tx: number;
  ty: number;
  rms: number;
  matched: number;
  valid: boolean;
}

export interface StarSeries {
  starId: number;
  x: Float64Array;
  y: Float64Array;
  flux: Float64Array;
  fluxErr: Float64Array;
  sky: Float64Array;
  fwhm: Float64Array;
  flags: Uint8Array;
}

export interface PhotometrySettings {
  thresholdSigma: number;
  apertureFactor: number;
  annulusGap: number;
  annulusWidth: number;
  gain: number;
  readNoise: number;
  maxStars: number;
  autoAlign: boolean;
}

export interface PhotometryResult {
  stars: Star[];
  refIndex: number;
  series: StarSeries[];
  times: Float64Array;
  timeSource: string;
  timesAreAbsolute: boolean;
  transforms: FrameTransform[];
  frameBackground: Float64Array;
  frameNoise: Float64Array;
  frameFwhm: Float64Array;
  frameAirmass: Float64Array;
  settings: PhotometrySettings;
  warnings: string[];
  aperturePx: number;
  timeSpanDays: number;
}

export interface LcOptions {
  targetIndex: number;
  detrendOrder: 0 | 1 | 2;
  useFwhm: boolean;
  useSky: boolean;
  useAirmass: boolean;
  useCentroid: boolean;
  clipSigma: number;
  binMinutes: number;
  variableClip: number;
}

export interface LightCurve {
  time: Float64Array;
  flux: Float64Array;
  err: Float64Array;
  raw: Float64Array;
  targetIndex: number;
  targetStar: Star;
  ensembleIndices: number[];
  ensembleIds: number[];
  detrended: boolean;
  binMinutes: number;
  timeLabel: string;
  timesAreAbsolute: boolean;
  warnings: string[];
}

export interface BinnedLightCurve {
  time: Float64Array;
  flux: Float64Array;
  err: Float64Array;
  n: Float64Array;
}

export interface BlsOptions {
  minPeriod: number;
  maxPeriod: number;
  nPeriods: number;
  minDurationHours: number;
  maxDurationHours: number;
  nBins: number;
}

export interface BlsPeak {
  period: number;
  score: number;
  depth: number;
  durationDays: number;
  t0: number;
}

export interface BlsSpectrumPoint {
  period: number;
  score: number;
}

export interface BlsResult {
  best: BlsPeak;
  peaks: BlsPeak[];
  spectrum: BlsSpectrumPoint[];
  sde: number;
  baseline: number;
  nPoints: number;
  options: BlsOptions;
}

export interface TransitParams {
  period: number;
  t0: number;
  depth: number;
  duration: number;
  ingress: number;
}

export interface TransitFit {
  params: TransitParams;
  errors: Partial<Record<keyof TransitParams, number>>;
  chi2: number;
  dof: number;
  rms: number;
  snr: number;
  modelFlux: Float64Array;
  residuals: Float64Array;
  events: Array<{ epoch: number; center: number; depth: number; error: number; n: number }>;
  periodAtBoundary: boolean;
  warnings: string[];
}

export type FlagSeverity = 'good' | 'warn' | 'bad' | 'unknown';

export interface VettingFlag {
  id: string;
  severity: FlagSeverity;
  title: string;
  detail: string;
  value?: string;
}

export interface VettingResult {
  flags: VettingFlag[];
  verdict: 'strong' | 'candidate' | 'weak' | 'false-positive' | 'insufficient';
  score: number;
  oddEven: { depthOdd: number; depthEven: number; sigma: number; nOdd: number; nEven: number };
  secondary: { depth: number; sigma: number };
  centroid: { dx: number; dy: number; sigma: number };
  redNoise: number;
  shapeRatio: number;
}

export interface ImagingSettings {
  center: { x: number; y: number } | null;
  angleMode: 'header' | 'manual' | 'none';
  manualStart: number;
  manualStep: number;
  minSeparation: number;
  maxSeparation: number;
  threshold: number;
  pixelScale: number;
  maxFrames: number;
}

export interface ContrastPoint {
  sepPx: number;
  sepArcsec: number;
  sigma: number;
  contrast1: number;
  contrast5: number;
  contrast5Mag: number;
}

export interface ImagingCandidate {
  id: number;
  x: number;
  y: number;
  sepPx: number;
  sepArcsec: number;
  pa: number;
  snr: number;
  contrast: number;
  contrastMag: number;
}

export interface ImagingResult {
  reference: Float32Array;
  combined: Float32Array;
  snrMap: Float32Array;
  width: number;
  height: number;
  center: { x: number; y: number };
  starPeak: number;
  contrastCurve: ContrastPoint[];
  candidates: ImagingCandidate[];
  framesUsed: number;
  totalRotation: number;
  angleSource: string;
  warnings: string[];
  settings: ImagingSettings;
  elapsedMs: number;
}

export interface ProgressInfo {
  label: string;
  value: number;
  detail?: string;
}
