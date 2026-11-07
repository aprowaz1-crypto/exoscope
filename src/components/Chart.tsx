import {
  useId,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

export interface ChartSeries {
  label?: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color?: string;
  kind?: 'line' | 'dots';
  width?: number;
  opacity?: number;
  dash?: string;
}

export interface ChartLine {
  value: number;
  axis: 'x' | 'y';
  color?: string;
  label?: string;
  dash?: string;
}

export interface ChartBand {
  x0: number;
  x1: number;
  color?: string;
  label?: string;
}

export interface ChartMarker {
  x: number;
  y: number;
  color?: string;
  label?: string;
}

export interface ChartProps {
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
  xScale?: 'linear' | 'log';
  yScale?: 'linear' | 'log';
  xDomain?: [number, number];
  yDomain?: [number, number];
  height?: number;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  lines?: ChartLine[];
  bands?: ChartBand[];
  markers?: ChartMarker[];
  legend?: boolean;
  hover?: boolean;
  svgRef?: Ref<SVGSVGElement>;
  ariaLabel?: string;
}

const WIDTH = 920;
const MARGIN = { left: 68, right: 18, top: 16, bottom: 48 };

function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const factor = norm <= 1.2 ? 1 : norm <= 2.4 ? 2 : norm <= 6 ? 5 : 10;
  return factor * mag;
}

function linearTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start, i = 0; v <= max + step * 1e-6 && i < 40; v += step, i++) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const ticks: number[] = [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  for (let e = lo; e <= hi; e++) {
    const base = 10 ** e;
    for (const f of [1, 2, 5]) {
      const v = f * base;
      if (v >= min * 0.999 && v <= max * 1.001) ticks.push(v);
    }
    if (ticks.length > 30) break;
  }
  return ticks;
}

export function defaultFormat(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e6 || abs < 1e-3) {
    const exp = value.toExponential(1);
    return exp.replace('e+', 'e');
  }
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(digits);
}

/** Tick labels should stay compact; the tooltip uses the full formatter. */
function tickLabel(value: number, formatter?: (v: number) => string): string {
  if (formatter) return formatter(value);
  return defaultFormat(value, 3);
}

function nearestIndex(values: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const v = values[mid];
    if (!Number.isFinite(v)) break;
    if (v < target) lo = mid;
    else hi = mid;
  }
  let best = -1;
  let bestDist = Infinity;
  for (let i = Math.max(0, lo - 2); i <= Math.min(values.length - 1, hi + 2); i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(v - target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function Chart({
  series,
  xLabel,
  yLabel,
  xScale = 'linear',
  yScale = 'linear',
  xDomain,
  yDomain,
  height = 340,
  formatX,
  formatY,
  lines = [],
  bands = [],
  markers = [],
  legend = true,
  hover = true,
  svgRef,
  ariaLabel,
}: ChartProps) {
  const clipId = useId().replace(/:/g, '');
  const rectRef = useRef<SVGRectElement>(null);
  const [hoverState, setHoverState] = useState<{ pixelX: number; index: number } | null>(null);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;

  const bounds = useMemo(() => {
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const s of series) {
      const n = Math.min(s.x.length, s.y.length);
      for (let i = 0; i < n; i++) {
        const x = s.x[i];
        const y = s.y[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (xScale === 'log' && !(x > 0)) continue;
        if (yScale === 'log' && !(y > 0)) continue;
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
    }
    for (const line of lines) {
      if (line.axis === 'y' && Number.isFinite(line.value)) {
        if (line.value < ymin) ymin = line.value;
        if (line.value > ymax) ymax = line.value;
      }
      if (line.axis === 'x' && Number.isFinite(line.value)) {
        if (line.value < xmin) xmin = line.value;
        if (line.value > xmax) xmax = line.value;
      }
    }
    for (const marker of markers) {
      if (Number.isFinite(marker.x)) {
        if (marker.x < xmin) xmin = marker.x;
        if (marker.x > xmax) xmax = marker.x;
      }
      if (Number.isFinite(marker.y)) {
        if (marker.y < ymin) ymin = marker.y;
        if (marker.y > ymax) ymax = marker.y;
      }
    }
    if (!Number.isFinite(xmin) || !Number.isFinite(ymin)) {
      xmin = 0;
      xmax = 1;
      ymin = 0;
      ymax = 1;
    }
    if (xDomain) {
      xmin = xDomain[0];
      xmax = xDomain[1];
    } else if (xScale === 'log') {
      const lo = Math.log10(xmin);
      const hi = Math.log10(Math.max(xmax, xmin * 1.01));
      const pad = (hi - lo) * 0.02;
      xmin = 10 ** (lo - pad);
      xmax = 10 ** (hi + pad);
    } else {
      const span = xmax - xmin || Math.abs(xmax) || 1;
      xmin -= span * 0.02;
      xmax += span * 0.02;
    }
    if (yDomain) {
      ymin = yDomain[0];
      ymax = yDomain[1];
    } else if (yScale === 'log') {
      const lo = Math.log10(ymin);
      const hi = Math.log10(Math.max(ymax, ymin * 1.01));
      const pad = (hi - lo) * 0.04;
      ymin = 10 ** (lo - pad);
      ymax = 10 ** (hi + pad);
    } else {
      const span = ymax - ymin || Math.abs(ymax) || 1;
      ymin -= span * 0.06;
      ymax += span * 0.06;
    }
    return { xmin, xmax, ymin, ymax };
  }, [series, xScale, yScale, xDomain, yDomain, lines, markers]);

  const sx = (x: number): number => {
    if (xScale === 'log') {
      return (
        MARGIN.left +
        ((Math.log10(x) - Math.log10(bounds.xmin)) /
          (Math.log10(bounds.xmax) - Math.log10(bounds.xmin))) *
          plotWidth
      );
    }
    return MARGIN.left + ((x - bounds.xmin) / (bounds.xmax - bounds.xmin)) * plotWidth;
  };
  const sy = (y: number): number => {
    if (yScale === 'log') {
      return (
        MARGIN.top +
        plotHeight -
        ((Math.log10(y) - Math.log10(bounds.ymin)) /
          (Math.log10(bounds.ymax) - Math.log10(bounds.ymin))) *
          plotHeight
      );
    }
    return MARGIN.top + plotHeight - ((y - bounds.ymin) / (bounds.ymax - bounds.ymin)) * plotHeight;
  };
  const inverseX = (pixel: number): number => {
    const t = (pixel - MARGIN.left) / plotWidth;
    if (xScale === 'log') {
      const lo = Math.log10(bounds.xmin);
      const hi = Math.log10(bounds.xmax);
      return 10 ** (lo + t * (hi - lo));
    }
    return bounds.xmin + t * (bounds.xmax - bounds.xmin);
  };

  const xTicks = xScale === 'log' ? logTicks(bounds.xmin, bounds.xmax) : linearTicks(bounds.xmin, bounds.xmax, 7);
  const yTicks = yScale === 'log' ? logTicks(bounds.ymin, bounds.ymax) : linearTicks(bounds.ymin, bounds.ymax, 5);
  const hoverSeries = series.find((s) => s.kind !== 'dots' && s.x.length > 0) ?? series.find((s) => s.x.length > 0);
  const hoverXValue = hoverState && hoverSeries ? inverseX(hoverState.pixelX) : NaN;
  const hoverIndex =
    hoverSeries && Number.isFinite(hoverXValue) ? nearestIndex(hoverSeries.x, hoverXValue) : -1;

  const hoverX = hoverSeries && hoverIndex >= 0 ? hoverSeries.x[hoverIndex] : NaN;
  const hoverRows =
    Number.isFinite(hoverX)
      ? series
          .map((s) => {
            const n = Math.min(s.x.length, s.y.length);
            let value = NaN;
            if (s === hoverSeries && hoverIndex >= 0 && hoverIndex < n) {
              value = s.y[hoverIndex];
            } else if (n > 0) {
              const idx = nearestIndex(s.x, hoverX);
              if (idx >= 0 && idx < n) value = s.y[idx];
            }
            return { label: s.label, color: s.color, value };
          })
          .filter((row) => Number.isFinite(row.value))
      : [];
  const tooltipX = Number.isFinite(hoverX) ? sx(hoverX) : 0;
  const tooltipRows = hoverRows.slice(0, 5);
  const tooltipWidth = 188;
  const tooltipHeight = 26 + tooltipRows.length * 18;
  const tooltipLeft =
    tooltipX + tooltipWidth + 18 > WIDTH - MARGIN.right ? tooltipX - tooltipWidth - 12 : tooltipX + 12;

  function pathFor(s: ChartSeries): string {
    const n = Math.min(s.x.length, s.y.length);
    let path = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const x = s.x[i];
      const y = s.y[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      if (xScale === 'log' && !(x > 0)) {
        pen = false;
        continue;
      }
      if (yScale === 'log' && !(y > 0)) {
        pen = false;
        continue;
      }
      const px = x < bounds.xmin ? MARGIN.left : x > bounds.xmax ? MARGIN.left + plotWidth : sx(x);
      const py = y < bounds.ymin ? MARGIN.top + plotHeight : y > bounds.ymax ? MARGIN.top : sy(y);
      if (s.kind === 'dots') {
        path += `M${px.toFixed(1)} ${py.toFixed(1)}l0.01 0`;
        pen = false;
      } else if (!pen) {
        path += `M${px.toFixed(1)} ${py.toFixed(1)}`;
        pen = true;
      } else {
        path += `L${px.toFixed(1)} ${py.toFixed(1)}`;
      }
    }
    return path;
  }

  const hasData = series.some((s) => s.x.length > 0);

  if (!hasData) {
    return <div className="chart-empty">—</div>;
  }

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        className="chart"
        viewBox={`0 0 ${WIDTH} ${height}`}
        width={WIDTH}
        height={height}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <clipPath id={`clip-${clipId}`}>
            <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>
        {bands.map((band, index) => {
          const x0 = sx(Math.max(band.x0, bounds.xmin));
          const x1 = sx(Math.min(band.x1, bounds.xmax));
          if (!Number.isFinite(x0) || !Number.isFinite(x1)) return null;
          return (
            <rect
              key={`band-${index}`}
              x={Math.min(x0, x1)}
              y={MARGIN.top}
              width={Math.abs(x1 - x0)}
              height={plotHeight}
              fill={band.color ?? 'rgba(56,217,255,0.08)'}
            />
          );
        })}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotWidth}
          height={plotHeight}
          className="chart-plot-bg"
        />
        {yTicks.map((tick) => (
          <g key={`yt-${tick}`}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={sy(tick)}
              y2={sy(tick)}
              className="chart-grid"
            />
            <text x={MARGIN.left - 10} y={sy(tick) + 4} className="chart-tick" textAnchor="end">
              {tickLabel(tick, formatY)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`xt-${tick}`}>
            <line
              x1={sx(tick)}
              x2={sx(tick)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              className="chart-grid"
            />
            <text
              x={sx(tick)}
              y={MARGIN.top + plotHeight + 20}
              className="chart-tick"
              textAnchor="middle"
            >
              {tickLabel(tick, formatX)}
            </text>
          </g>
        ))}
        {lines.map((line, index) =>
          line.axis === 'y' ? (
            <line
              key={`line-${index}`}
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={sy(line.value)}
              y2={sy(line.value)}
              stroke={line.color ?? '#7dd3fc'}
              strokeWidth={1}
              strokeDasharray={line.dash ?? '5 4'}
            />
          ) : (
            <line
              key={`line-${index}`}
              x1={sx(line.value)}
              x2={sx(line.value)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke={line.color ?? '#7dd3fc'}
              strokeWidth={1}
              strokeDasharray={line.dash ?? '5 4'}
            />
          ),
        )}
        <g clipPath={`url(#clip-${clipId})`}>
          {series.map((s, index) => (
            <path
              key={`series-${index}`}
              d={pathFor(s)}
              fill="none"
              stroke={s.color ?? '#38d9ff'}
              strokeWidth={s.kind === 'dots' ? (s.width ?? 3.4) : (s.width ?? 1.5)}
              strokeLinecap={s.kind === 'dots' ? 'round' : 'round'}
              strokeLinejoin="round"
              strokeDasharray={s.dash}
              opacity={s.opacity ?? 1}
            />
          ))}
          {markers.map((marker, index) =>
            Number.isFinite(marker.x) && Number.isFinite(marker.y) ? (
              <g key={`marker-${index}`}>
                <circle
                  cx={sx(marker.x)}
                  cy={sy(marker.y)}
                  r={5.5}
                  fill="none"
                  stroke={marker.color ?? '#fbbf24'}
                  strokeWidth={1.6}
                />
                <circle cx={sx(marker.x)} cy={sy(marker.y)} r={1.6} fill={marker.color ?? '#fbbf24'} />
                {marker.label && (
                  <text
                    x={sx(marker.x) + 9}
                    y={sy(marker.y) - 8}
                    className="chart-marker-label"
                    fill={marker.color ?? '#fbbf24'}
                  >
                    {marker.label}
                  </text>
                )}
              </g>
            ) : null,
          )}
          {hoverState && hoverIndex >= 0 && Number.isFinite(hoverX) && (
            <line
              x1={tooltipX}
              x2={tooltipX}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke="rgba(167, 139, 250, 0.65)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </g>
        <rect
          ref={rectRef}
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          style={{ cursor: hover ? 'crosshair' : 'default' }}
          onMouseMove={(event) => {
            if (!hover) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const pixel = ((event.clientX - rect.left) / rect.width) * plotWidth + MARGIN.left;
            setHoverState({ pixelX: pixel, index: 0 });
          }}
          onMouseLeave={() => setHoverState(null)}
        />
        {yLabel && (
          <text
            x={16}
            y={MARGIN.top + plotHeight / 2}
            className="chart-axis-label"
            textAnchor="middle"
            transform={`rotate(-90 16 ${MARGIN.top + plotHeight / 2})`}
          >
            {yLabel}
          </text>
        )}
        {xLabel && (
          <text
            x={MARGIN.left + plotWidth / 2}
            y={height - 8}
            className="chart-axis-label"
            textAnchor="middle"
          >
            {xLabel}
          </text>
        )}
        {hoverState && hoverIndex >= 0 && tooltipRows.length > 0 && (
          <g pointerEvents="none">
            <rect
              x={tooltipLeft}
              y={MARGIN.top + 8}
              width={tooltipWidth}
              height={tooltipHeight}
              rx={8}
              className="chart-tooltip-bg"
            />
            <text x={tooltipLeft + 11} y={MARGIN.top + 27} className="chart-tooltip-title">
              {xLabel ? `${xLabel}: ` : ''}
              {formatX ? formatX(hoverX) : defaultFormat(hoverX, 6)}
            </text>
            {tooltipRows.map((row, index) => (
              <g key={`tt-${index}`}>
                <circle
                  cx={tooltipLeft + 14}
                  cy={MARGIN.top + 43 + index * 18}
                  r={3}
                  fill={row.color ?? '#38d9ff'}
                />
                <text
                  x={tooltipLeft + 23}
                  y={MARGIN.top + 47 + index * 18}
                  className="chart-tooltip-row"
                >
                  {row.label ? `${row.label}: ` : ''}
                  {defaultFormat(row.value, 6)}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {legend && series.some((s) => s.label) && (
        <div className="chart-legend">
          {series
            .filter((s) => s.label)
            .map((s, index) => (
              <span key={`legend-${index}`} className="chart-legend-item">
                <i style={{ background: s.color ?? '#38d9ff' }} />
                {s.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
