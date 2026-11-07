import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icons';

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = '',
  tone,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'accent' | 'danger';
  id?: string;
}) {
  return (
    <section className={`card card-${tone ?? 'default'} ${className}`} id={id}>
      {(title || actions) && (
        <header className="card-head">
          <div className="card-title-wrap">
            {icon && (
              <span className="card-icon">
                <Icon name={icon} />
              </span>
            )}
            <div>
              {title && <h2 className="card-title">{title}</h2>}
              {subtitle && <p className="card-subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  inline = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={`field ${inline ? 'field-inline' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const format = (v: number) => (Number.isFinite(v) ? String(v) : '');
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    const parsed = Number(text);
    if (!(text.trim() !== '' && Number.isFinite(parsed) && parsed === value)) {
      setText(format(value));
    }
    // Only resync when the external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className={`number-wrap ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const parsed = Number(next);
          if (next.trim() !== '' && Number.isFinite(parsed)) {
            let clamped = parsed;
            if (min !== undefined && clamped < min) clamped = min;
            if (max !== undefined && clamped > max) clamped = max;
            onChange(clamped);
          }
        }}
        onBlur={() => setText(format(value))}
      />
      {suffix && <span className="number-suffix">{suffix}</span>}
    </span>
  );
}

export function RangeInput({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  format = (v) => String(v),
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  return (
    <span className="range-wrap">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{format(value)}</output>
    </span>
  );
}

export function SelectInput<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      className="select"
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        const found = options.find((option) => String(option.value) === raw);
        if (found) onChange(found.value);
        else onChange((typeof value === 'number' ? Number(raw) : raw) as T);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`checkbox ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="checkbox-box" aria-hidden="true">
        <Icon name="check" size={13} />
      </span>
      <span>{label}</span>
    </label>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  icon,
  children,
  loading = false,
  className = '',
  ...rest
}: {
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${loading ? 'is-loading' : ''} ${className}`}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'violet';
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function Progress({
  value,
  label,
  detail,
}: {
  value: number;
  label?: string;
  detail?: string;
}) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="progress" aria-live="polite">
      <div className="progress-head">
        <span>{label}</span>
        <span className="mono">{percent.toFixed(0)}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {detail && <div className="progress-detail">{detail}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  onClose,
}: {
  tone?: 'info' | 'good' | 'warn' | 'bad';
  title?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
}) {
  const icon: IconName = tone === 'good' ? 'check' : tone === 'warn' || tone === 'bad' ? 'warn' : 'info';
  return (
    <div className={`alert alert-${tone}`}>
      <span className="alert-icon">
        <Icon name={icon} size={17} />
      </span>
      <div className="alert-content">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="alert-body">{children}</div>}
      </div>
      {onClose && (
        <button type="button" className="icon-btn alert-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'accent';
}) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={`stat-grid ${compact ? 'is-compact' : ''}`}>{children}</div>;
}

export function StepHeader({
  index,
  title,
  subtitle,
  done,
  aside,
}: {
  index: number;
  title: ReactNode;
  subtitle?: ReactNode;
  done?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className="step-head">
      <span className={`step-index ${done ? 'is-done' : ''}`}>
        {done ? <Icon name="check" size={16} /> : index}
      </span>
      <div className="step-titles">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {aside && <div className="step-aside">{aside}</div>}
    </div>
  );
}

export function EmptyState({
  icon = 'spark',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Divider({ label }: { label?: string }) {
  return label ? (
    <div className="divider">
      <span>{label}</span>
    </div>
  ) : (
    <hr className="divider-line" />
  );
}
