import { useRef, useState } from 'react';
import { Icon } from './Icons';
import { useI18n } from '../i18n';

const ACCEPT =
  '.fits,.fit,.fts,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,image/fits,image/png,image/jpeg,image/webp';

export function UploadZone({
  onFiles,
  disabled,
  compact = false,
  title,
  hint,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  title?: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    onFiles(Array.from(list));
  };

  return (
    <div
      className={`upload-zone ${compact ? 'is-compact' : ''} ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <span className="upload-icon">
        <Icon name="upload" size={compact ? 20 : 26} />
      </span>
      <div className="upload-text">
        <strong>{title ?? t('Перетягніть кадри сюди або натисніть, щоб вибрати')}</strong>
        <span>
          {hint ??
            t('FITS (зображення та куби NAXIS=3), PNG, JPEG, WEBP. Обробка відбувається локально у браузері.')}
        </span>
      </div>
    </div>
  );
}
