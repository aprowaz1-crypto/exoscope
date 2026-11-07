import type { BlsOptions, BlsResult } from '../types';
import { blsSearch } from './bls';

interface WorkerResponse {
  type: 'progress' | 'done' | 'error';
  fraction?: number;
  bestScore?: number;
  result?: BlsResult;
  message?: string;
}

/**
 * Runs BLS in a module Web Worker. Falls back to the synchronous implementation
 * when workers are unavailable (e.g. file://) or fail to load.
 */
export function searchBlsAsync(
  time: Float64Array,
  flux: Float64Array,
  err: Float64Array,
  options: BlsOptions,
  onProgress?: (fraction: number, bestScore: number) => void,
): Promise<BlsResult> {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(blsSearch(time, flux, err, options));
  }
  let worker: Worker;
  try {
    const url = new URL('assets/bls-worker.js', document.baseURI);
    worker = new Worker(url, { type: 'module' });
  } catch {
    return Promise.resolve(blsSearch(time, flux, err, options));
  }
  return new Promise<BlsResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      fn();
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.fraction ?? 0, data.bestScore ?? 0);
      } else if (data.type === 'done' && data.result) {
        finish(() => resolve(data.result!));
      } else if (data.type === 'error') {
        finish(() => reject(new Error(data.message ?? 'BLS worker failed')));
      }
    };
    worker.onerror = () => {
      // Likely a missing/incompatible worker script: run synchronously.
      finish(() => {
        try {
          resolve(blsSearch(time, flux, err, options, onProgress));
        } catch (error) {
          reject(error);
        }
      });
    };
    const payload = {
      time,
      flux,
      err,
      options,
    };
    worker.postMessage(payload);
  });
}
