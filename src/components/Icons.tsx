import type { ReactElement, SVGProps } from 'react';

export type IconName =
  | 'planet'
  | 'transit'
  | 'telescope'
  | 'upload'
  | 'play'
  | 'download'
  | 'star'
  | 'chart'
  | 'check'
  | 'warn'
  | 'x'
  | 'info'
  | 'image'
  | 'target'
  | 'settings'
  | 'file'
  | 'spark'
  | 'arrow'
  | 'refresh'
  | 'shield'
  | 'eye'
  | 'layers';

const paths: Record<IconName, ReactElement> = {
  planet: (
    <>
      <circle cx="12" cy="12" r="7" />
      <ellipse cx="12" cy="12" rx="10.5" ry="3.4" transform="rotate(-24 12 12)" />
      <circle cx="19.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  transit: (
    <>
      <circle cx="12" cy="12" r="4.6" />
      <path d="M2.5 8.5h4M17.5 8.5h4M2.5 12h3M18.5 12h3M2.5 15.5h4M17.5 15.5h4" />
    </>
  ),
  telescope: (
    <>
      <path d="M3.5 14.2 19 5.4l1.8 3.1L5.3 17.3z" />
      <path d="m11.5 12.8 3.2 5.5M8.5 19.5h8M14.7 18.3l-2-4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" />,
  download: (
    <>
      <path d="M12 4v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  star: (
    <path d="m12 3.2 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z" />
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="m7 15 3.5-4 3 2.5L20 6.5" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5L20 6.5" />,
  warn: (
    <>
      <path d="M12 3.5 22 20.5H2z" />
      <path d="M12 9v5.5M12 17.5v.1" />
    </>
  ),
  x: <path d="m5 5 14 14M19 5 5 19" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6M12 7.4v.1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.6" />
      <path d="m4 17 5-5 4 4 3-2.5 4 3.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.7 7.7 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
    </>
  ),
  file: (
    <>
      <path d="M6 2.5h8l4 4v15H6z" />
      <path d="M14 2.5v4h4M9 12h6M9 16h6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 2.5 13.8 9l6.7 1.8-6.7 1.8L12 19l-1.8-6.4L3.5 10.8 10.2 9z" />
      <path d="m19 16 .8 2.5L22 19.5l-2.2.8L19 23l-.8-2.7-2.2-.8 2.2-1z" />
    </>
  ),
  arrow: <path d="M4.5 12h15m0 0-6-6m6 6-6 6" />,
  refresh: (
    <>
      <path d="M20 8a8.5 8.5 0 1 0 1 6" />
      <path d="M20.5 3.5V8h-4.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 20 6v6c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
