import { blsSearch } from '../lib/bls';
import type { BlsOptions } from '../types';

interface RequestMessage {
  time: Float64Array;
  flux: Float64Array;
  err: Float64Array;
  options: BlsOptions;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const { time, flux, err, options } = event.data;
  try {
    const result = blsSearch(time, flux, err, options, (fraction, bestScore) => {
      scope.postMessage({ type: 'progress', fraction, bestScore });
    });
    scope.postMessage({ type: 'done', result });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'BLS worker failed',
    });
  }
};
