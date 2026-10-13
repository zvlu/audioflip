import { OUTPUT_CEILING, peakGuardGain, peakOf } from './math';
import type { WavSource } from './types';

export const WORKER_THRESHOLD_SAMPLES = 1_000_000;
export const MAX_WORKER_TRANSFER_BYTES = 32 * 1024 * 1024;
export const WORKER_TIMEOUT_MS = 10_000;

export type PeakMeasurement = {
  peak: number;
  guardGain: number;
  mode: 'main-thread' | 'worker';
};

export class PeakMeasurementCancelledError extends Error {
  constructor() {
    super('Peak measurement was cancelled.');
    this.name = 'PeakMeasurementCancelledError';
  }
}

export function isPeakMeasurementCancelled(error: unknown): error is PeakMeasurementCancelledError {
  return error instanceof PeakMeasurementCancelledError || (error instanceof Error && error.name === 'PeakMeasurementCancelledError');
}

type WorkerRequest = {
  kind: 'scan-peak';
  id: number;
  ceiling: number;
  channels: ArrayBuffer[];
};

type WorkerMessage = {
  kind?: unknown;
  id?: unknown;
  peak?: unknown;
  guardGain?: unknown;
};

type ValidWorkerResult = {
  kind: 'peak-result';
  id: number;
  peak: number;
  guardGain: number;
};

export type PeakWorkerLike = {
  postMessage: (message: WorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type PeakWorkerFactory = () => PeakWorkerLike | null;

type PendingJob = {
  id: number;
  source: WavSource;
  resolve: (result: PeakMeasurement) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
};

export type PeakServiceOptions = {
  workerFactory?: PeakWorkerFactory;
  thresholdSamples?: number;
  maxTransferBytes?: number;
  timeoutMs?: number;
};

function mainThreadMeasurement(source: WavSource): PeakMeasurement {
  const peak = peakOf(source);
  return { peak, guardGain: peakGuardGain(peak, OUTPUT_CEILING), mode: 'main-thread' };
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function sampleCountForPeak(source: Pick<WavSource, 'length' | 'numberOfChannels'>): number | null {
  if (!validPositiveInteger(source.length) || !validPositiveInteger(source.numberOfChannels)) return null;
  const samples = source.length * source.numberOfChannels;
  return Number.isSafeInteger(samples) ? samples : null;
}

export function transferBytesForPeak(source: Pick<WavSource, 'length' | 'numberOfChannels'>): number | null {
  const samples = sampleCountForPeak(source);
  if (samples === null) return null;
  const bytes = samples * Float32Array.BYTES_PER_ELEMENT;
  return Number.isSafeInteger(bytes) ? bytes : null;
}

export function shouldUsePeakWorker(
  source: Pick<WavSource, 'length' | 'numberOfChannels'>,
  thresholdSamples = WORKER_THRESHOLD_SAMPLES,
  maxTransferBytes = MAX_WORKER_TRANSFER_BYTES,
): boolean {
  const samples = sampleCountForPeak(source);
  const bytes = transferBytesForPeak(source);
  return samples !== null
    && bytes !== null
    && Number.isSafeInteger(thresholdSamples)
    && thresholdSamples > 0
    && Number.isSafeInteger(maxTransferBytes)
    && maxTransferBytes > 0
    && samples >= thresholdSamples
    && bytes <= maxTransferBytes;
}

/** Copies channels before transfer so a live AudioBuffer remains available for preview and PCM encoding. */
export function copyChannelsForPeakTransfer(source: WavSource): ArrayBuffer[] {
  const copies: ArrayBuffer[] = [];
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const data = source.getChannelData(channel);
    if (!(data instanceof Float32Array) || data.length !== source.length) {
      throw new Error('Peak scan could not copy the rendered channel data.');
    }
    copies.push(data.slice().buffer);
  }
  return copies;
}

function defaultWorkerFactory(): PeakWorkerLike | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./peak-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

function isValidWorkerResult(message: WorkerMessage, id: number): message is ValidWorkerResult {
  if (message.kind !== 'peak-result' || message.id !== id || typeof message.peak !== 'number' || typeof message.guardGain !== 'number') {
    return false;
  }
  if (!Number.isFinite(message.peak) || message.peak < 0 || !Number.isFinite(message.guardGain) || message.guardGain <= 0 || message.guardGain > 1) {
    return false;
  }
  const expectedGain = peakGuardGain(message.peak, OUTPUT_CEILING);
  return Math.abs(expectedGain - message.guardGain) < 1e-12;
}

export function createPeakMeasurementService(options: PeakServiceOptions = {}) {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const thresholdSamples = options.thresholdSamples ?? WORKER_THRESHOLD_SAMPLES;
  const maxTransferBytes = options.maxTransferBytes ?? MAX_WORKER_TRANSFER_BYTES;
  const timeoutMs = Math.max(1, options.timeoutMs ?? WORKER_TIMEOUT_MS);
  let worker: PeakWorkerLike | null = null;
  let pending: PendingJob | null = null;
  let nextId = 1;

  function disposeWorker(): void {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }

  function clearPending(): PendingJob | null {
    const current = pending;
    pending = null;
    if (!current) return null;
    clearTimeout(current.timer);
    if (current.signal && current.abortListener) current.signal.removeEventListener('abort', current.abortListener);
    return current;
  }

  function resolveMainThreadFallback(current: PendingJob): void {
    try {
      current.resolve(mainThreadMeasurement(current.source));
    } catch (reason) {
      current.reject(reason);
    }
  }

  function settleWithFallback(resetWorker: boolean): void {
    const current = clearPending();
    if (resetWorker) disposeWorker();
    if (current) resolveMainThreadFallback(current);
  }

  function cancelPending(): void {
    const current = clearPending();
    disposeWorker();
    if (current) current.reject(new PeakMeasurementCancelledError());
  }

  function ensureWorker(): PeakWorkerLike | null {
    if (worker) return worker;
    const created = workerFactory();
    if (!created) return null;
    worker = created;
    worker.onmessage = (event) => {
      const current = pending;
      if (!current || event.data?.id !== current.id) return;
      if (!isValidWorkerResult(event.data, current.id)) {
        settleWithFallback(true);
        return;
      }
      clearPending();
      current.resolve({ peak: event.data.peak, guardGain: event.data.guardGain, mode: 'worker' });
    };
    worker.onerror = () => settleWithFallback(true);
    return worker;
  }

  async function measure(source: WavSource, signal?: AbortSignal): Promise<PeakMeasurement> {
    if (signal?.aborted) throw new PeakMeasurementCancelledError();
    if (!shouldUsePeakWorker(source, thresholdSamples, maxTransferBytes) || pending) {
      return mainThreadMeasurement(source);
    }

    let copies: ArrayBuffer[];
    try {
      copies = copyChannelsForPeakTransfer(source);
    } catch {
      return mainThreadMeasurement(source);
    }
    if (signal?.aborted) throw new PeakMeasurementCancelledError();

    const currentWorker = ensureWorker();
    if (!currentWorker) return mainThreadMeasurement(source);

    const id = nextId++;
    return new Promise<PeakMeasurement>((resolve, reject) => {
      let job: PendingJob;
      const timer = setTimeout(() => {
        if (pending === job) settleWithFallback(true);
      }, timeoutMs);
      const abortListener = () => {
        if (pending === job) cancelPending();
      };
      job = { id, source, resolve, reject, timer, signal, abortListener };
      pending = job;
      signal?.addEventListener('abort', abortListener, { once: true });
      if (signal?.aborted) {
        cancelPending();
        return;
      }

      try {
        currentWorker.postMessage(
          { kind: 'scan-peak', id, ceiling: OUTPUT_CEILING, channels: copies },
          copies,
        );
      } catch {
        settleWithFallback(true);
      }
    });
  }

  return {
    measure,
    dispose: () => {
      cancelPending();
      disposeWorker();
    },
  };
}

const defaultPeakService = createPeakMeasurementService();

export function measurePeakWithFallback(source: WavSource, signal?: AbortSignal): Promise<PeakMeasurement> {
  return defaultPeakService.measure(source, signal);
}
