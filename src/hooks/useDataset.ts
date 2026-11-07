import { useCallback, useRef, useState } from 'react';
import type { Dataset, ProgressInfo } from '../types';
import { loadFiles } from '../lib/ingest';
import { generateImagingDemo, generateTransitDemo } from '../lib/demo';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Невідома помилка';
}

export interface DatasetLoader {
  dataset: Dataset | null;
  busy: null | 'files' | 'demo';
  progress: ProgressInfo | null;
  error: string | null;
  warnings: string[];
  loadFiles: (files: File[]) => Promise<void>;
  loadDemo: () => Promise<void>;
  setDataset: (dataset: Dataset | null) => void;
  setError: (error: string | null) => void;
  dismissWarnings: () => void;
  reset: () => void;
}

export function useDataset(kind: 'transit' | 'imaging'): DatasetLoader {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState<null | 'files' | 'demo'>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const runId = useRef(0);

  const loadFilesCb = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const id = ++runId.current;
      setBusy('files');
      setError(null);
      setWarnings([]);
      setProgress({ label: 'Читання файлів', value: 0 });
      try {
        const result = await loadFiles(files, {
          onProgress: (value, label) => {
            if (runId.current === id) setProgress({ label, value });
          },
        });
        if (runId.current !== id) return;
        setDataset(result.dataset);
        setWarnings(result.warnings);
        setProgress({ label: 'Готово', value: 1 });
      } catch (err) {
        if (runId.current === id) {
          setError(errorMessage(err));
          setProgress(null);
        }
      } finally {
        if (runId.current === id) setBusy(null);
      }
    },
    [],
  );

  const loadDemo = useCallback(async () => {
    const id = ++runId.current;
    setBusy('demo');
    setError(null);
    setWarnings([]);
    setProgress({ label: 'Генерація демонстраційних даних', value: 0 });
    try {
      const generator = kind === 'transit' ? generateTransitDemo : generateImagingDemo;
      const generated = await generator({
        onProgress: (value, label) => {
          if (runId.current === id) setProgress({ label, value });
        },
      });
      if (runId.current !== id) return;
      setDataset(generated);
      setWarnings([]);
      setProgress({ label: 'Готово', value: 1 });
    } catch (err) {
      if (runId.current === id) {
        setError(errorMessage(err));
        setProgress(null);
      }
    } finally {
      if (runId.current === id) setBusy(null);
    }
  }, [kind]);

  const reset = useCallback(() => {
    runId.current++;
    setDataset(null);
    setBusy(null);
    setProgress(null);
    setError(null);
    setWarnings([]);
  }, []);

  return {
    dataset,
    busy,
    progress,
    error,
    warnings,
    loadFiles: loadFilesCb,
    loadDemo,
    setDataset,
    setError,
    dismissWarnings: () => setWarnings([]),
    reset,
  };
}
