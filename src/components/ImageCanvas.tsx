import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Icon } from './Icons';
import { downloadCanvasPng } from '../lib/export';

export type Palette = 'inferno' | 'gray' | 'cool' | 'viridis';

export interface ImageMarker {
  x: number;
  y: number;
  label?: string;
  kind?: 'star' | 'target' | 'candidate' | 'center';
  color?: string;
}

const PALETTES: Record<Palette, Array<[number, number, number]>> = {
  inferno: [
    [0, 0, 4],
    [40, 11, 84],
    [101, 21, 110],
    [159, 42, 99],
    [212, 72, 66],
    [245, 125, 21],
    [250, 193, 39],
    [252, 255, 164],
  ],
  gray: [
    [8, 10, 16],
    [64, 70, 84],
    [128, 136, 152],
    [196, 203, 216],
    [255, 255, 255],
  ],
  cool: [
    [4, 8, 24],
    [16, 42, 82],
    [24, 96, 148],
    [52, 168, 196],
    [148, 232, 226],
    [248, 255, 255],
  ],
  viridis: [
    [68, 1, 84],
    [72, 40, 120],
    [54, 92, 141],
    [39, 127, 142],
    [31, 161, 135],
    [74, 194, 109],
    [159, 218, 58],
    [253, 231, 37],
  ],
};

function buildLut(palette: Palette, log: boolean): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const stops = PALETTES[palette];
  for (let i = 0; i < 256; i++) {
    const t = log
      ? Math.log1p(i / 12) / Math.log1p(255 / 12)
      : i / 255;
    const pos = t * (stops.length - 1);
    const i0 = Math.min(stops.length - 1, Math.floor(pos));
    const i1 = Math.min(stops.length - 1, i0 + 1);
    const f = pos - i0;
    const a = stops[i0];
    const b = stops[i1];
    lut[i * 3] = a[0] + (b[0] - a[0]) * f;
    lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
    lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
  }
  return lut;
}

function sampleSorted(data: Float32Array): Float64Array {
  const target = 24000;
  const stride = Math.max(1, Math.floor(data.length / target));
  const values: number[] = [];
  for (let i = 0; i < data.length; i += stride) {
    const value = data[i];
    if (Number.isFinite(value)) values.push(value);
  }
  if (!values.length) return new Float64Array([0, 1]);
  const arr = Float64Array.from(values);
  arr.sort();
  return arr;
}

function pick(sorted: Float64Array, pct: number): number {
  const n = sorted.length;
  const index = Math.max(0, Math.min(n - 1, Math.round((pct / 100) * (n - 1))));
  return sorted[index];
}

export interface ImageCanvasProps {
  data: Float32Array;
  width: number;
  height: number;
  markers?: ImageMarker[];
  onClick?: (x: number, y: number) => void;
  ariaLabel?: string;
  showControls?: boolean;
  defaultLow?: number;
  defaultHigh?: number;
  defaultPalette?: Palette;
  compact?: boolean;
  style?: CSSProperties;
  maxHeight?: number;
  /** When set, shows a button that saves the rendered image as PNG. */
  downloadName?: string;
}

export function ImageCanvas({
  data,
  width,
  height,
  markers = [],
  onClick,
  ariaLabel,
  showControls = true,
  defaultLow = 0.5,
  defaultHigh = 99.6,
  defaultPalette = 'inferno',
  compact = false,
  style,
  maxHeight,
  downloadName,
}: ImageCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [lowPct, setLowPct] = useState(defaultLow);
  const [highPct, setHighPct] = useState(defaultHigh);
  const [palette, setPalette] = useState<Palette>(defaultPalette);
  const [log, setLog] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const sorted = useMemo(() => sampleSorted(data), [data]);
  const minValue = sorted[0];
  const maxValue = sorted[sorted.length - 1];
  const logAllowed = minValue > 0 && maxValue / Math.max(minValue, 1e-12) > 1.5;

  useEffect(() => {
    if (log && !logAllowed) setLog(false);
  }, [log, logAllowed]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const low = pick(sorted, Math.min(lowPct, highPct - 0.5));
    const high = Math.max(pick(sorted, highPct), low + 1e-12);
    const logLow = Math.log(Math.max(low, 1e-12));
    const logSpan = Math.log(high) - logLow || 1;
    const scale = 255 / (high - low);
    const lut = buildLut(palette, log);
    const image = ctx.createImageData(width, height);
    const pixels = image.data;
    for (let i = 0; i < width * height; i++) {
      const value = data[i];
      let level: number;
      if (!Number.isFinite(value)) level = 0;
      else if (log && value > 0) {
        const t = (Math.log(value) - logLow) / logSpan;
        level = Math.max(0, Math.min(255, Math.round(t * 255)));
      } else {
        level = Math.max(0, Math.min(255, Math.round((value - low) * scale)));
      }
      const lutIndex = level * 3;
      const offset = i * 4;
      pixels[offset] = lut[lutIndex];
      pixels[offset + 1] = lut[lutIndex + 1];
      pixels[offset + 2] = lut[lutIndex + 2];
      pixels[offset + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [data, width, height, sorted, lowPct, highPct, palette, log]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const base = Math.max(5, Math.min(width, height) * 0.017);
    const fontSize = Math.max(8, Math.min(14, Math.round(Math.min(width, height) * 0.038)));
    ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const marker of markers) {
      const x = marker.x;
      const y = marker.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const kind = marker.kind ?? 'star';
      const color =
        marker.color ??
        (kind === 'target'
          ? '#fb7185'
          : kind === 'candidate'
            ? '#fbbf24'
            : kind === 'center'
              ? '#a78bfa'
              : '#67e8f9');
      ctx.strokeStyle = color;
      ctx.lineWidth = kind === 'star' ? 1.1 : 1.9;
      if (kind === 'center') {
        const arm = base * 1.8;
        ctx.beginPath();
        ctx.moveTo(x - arm, y);
        ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x, y + arm);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, kind === 'target' ? base * 1.35 : base, 0, Math.PI * 2);
        ctx.stroke();
        if (kind === 'target') {
          ctx.beginPath();
          ctx.arc(x, y, base * 1.9, 0, Math.PI * 2);
          ctx.globalAlpha = 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      if (marker.label) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeText(marker.label, x + base * 1.5, y - base * 1.2);
        ctx.fillStyle = color;
        ctx.fillText(marker.label, x + base * 1.5, y - base * 1.2);
      }
    }
  }, [markers, width, height]);

  const hoverText = hover ? `x ${hover.x.toFixed(1)} • y ${hover.y.toFixed(1)}` : '';

  return (
    <div
      ref={wrapRef}
      className={`image-canvas-wrap ${compact ? 'is-compact' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
      style={style}
    >
      <div
        className="image-stage"
        style={{
          aspectRatio: `${width} / ${height}`,
          ...(maxHeight
            ? {
                maxHeight,
                maxWidth: `min(100%, ${Math.max(80, Math.round(maxHeight * (width / height)))}px)`,
              }
            : undefined),
        }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * width;
          const y = ((event.clientY - rect.top) / rect.height) * height;
          if (x >= 0 && y >= 0 && x < width && y < height) setHover({ x, y });
        }}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={baseRef} className="image-layer" aria-label={ariaLabel} role="img" />
        <canvas
          ref={overlayRef}
          className={`image-layer image-overlay ${onClick ? 'is-clickable' : ''}`}
          onClick={(event) => {
            if (!onClick) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * width;
            const y = ((event.clientY - rect.top) / rect.height) * height;
            onClick(x, y);
          }}
        />
        {hover && <span className="image-hover">{hoverText}</span>}
      </div>
      {showControls && (
        <div className="image-controls">
          <label className="mini-field">
            <span>Low</span>
            <input
              type="range"
              min={0}
              max={99}
              step={0.1}
              value={lowPct}
              onChange={(event) => setLowPct(Math.min(Number(event.target.value), highPct - 0.5))}
            />
            <output>{lowPct.toFixed(1)}%</output>
          </label>
          <label className="mini-field">
            <span>High</span>
            <input
              type="range"
              min={0.5}
              max={100}
              step={0.1}
              value={highPct}
              onChange={(event) => setHighPct(Math.max(Number(event.target.value), lowPct + 0.5))}
            />
            <output>{highPct.toFixed(1)}%</output>
          </label>
          <select
            className="select select-small"
            value={palette}
            onChange={(event) => setPalette(event.target.value as Palette)}
            aria-label="Palette"
          >
            <option value="inferno">Inferno</option>
            <option value="gray">Grey</option>
            <option value="cool">Cool</option>
            <option value="viridis">Viridis</option>
          </select>
          <label className={`mini-check ${logAllowed ? '' : 'is-disabled'}`} title={logAllowed ? '' : 'Data contain non-positive values'}>
            <input
              type="checkbox"
              checked={log}
              disabled={!logAllowed}
              onChange={(event) => setLog(event.target.checked)}
            />
            log
          </label>
          <button
            type="button"
            className="icon-btn"
            title="Reset stretch"
            onClick={() => {
              setLowPct(defaultLow);
              setHighPct(defaultHigh);
              setPalette(defaultPalette);
              setLog(false);
            }}
          >
            <Icon name="refresh" size={15} />
          </button>
          {downloadName && (
            <button
              type="button"
              className="icon-btn"
              title="Save PNG"
              onClick={() => {
                if (baseRef.current) void downloadCanvasPng(baseRef.current, downloadName);
              }}
            >
              <Icon name="download" size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Fullscreen"
            onClick={() => {
              const node = wrapRef.current;
              if (!node) return;
              if (document.fullscreenElement) {
                void document.exitFullscreen();
                setFullscreen(false);
              } else {
                void node.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => undefined);
              }
            }}
          >
            <Icon name="eye" size={15} />
          </button>
        </div>
      )}
      <div className="image-meta">
        <span>
          {width} × {height} px
        </span>
        <span className="mono">
          {minValue.toPrecision(4)} … {maxValue.toPrecision(4)}
        </span>
      </div>
    </div>
  );
}
