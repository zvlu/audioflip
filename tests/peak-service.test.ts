import { describe, expect, it, vi } from 'vitest';
import { OUTPUT_CEILING } from '../src/audio/math';
import {
  MAX_WORKER_TRANSFER_BYTES,
  copyChannelsForPeakTransfer,
  createPeakMeasurementService,
  shouldUsePeakWorker,
  transferBytesForPeak,
  type PeakWorkerLike,
} from '../src/audio/peak-service';
import type { WavSource } from '../src/audio/types';

function sourceFrom(channels: number[][]): WavSource {
  const data = channels.map((channel) => new Float32Array(channel));
  return {
    numberOfChannels: data.length,
    length: data[0]?.length ?? 0,
    sampleRate: 44_100,
    getChannelData(channel: number) {
      return data[channel];
    },
  };
}

function fakeWorker(onPost: (message: unknown, worker: PeakWorkerLike) => void): PeakWorkerLike {
  const worker: PeakWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      onPost(message, worker);
    },
    terminate: vi.fn(),
  };
  return worker;
}

describe('peak worker selection and copied transfer safety', () => {
  it('uses a bounded threshold and never transfers live channel backing storage', () => {
    const source = sourceFrom([[0.25, -0.5], [0.1, 0.2]]);
    const copies = copyChannelsForPeakTransfer(source);
    const live = source.getChannelData(0);

    expect(copies[0]).not.toBe(live.buffer);
    new Float32Array(copies[0])[0] = 0.99;
    expect(live[0]).toBeCloseTo(0.25);
    expect(transferBytesForPeak({ length: 4_000_000, numberOfChannels: 2 })).toBe(32_000_000);
    expect(shouldUsePeakWorker({ length: 500_000, numberOfChannels: 2 })).toBe(true);
    expect(shouldUsePeakWorker({ length: 500_000, numberOfChannels: 2 }, 1_000_001)).toBe(false);
    expect(shouldUsePeakWorker({ length: 5_000_000, numberOfChannels: 2 })).toBe(false);
    expect(MAX_WORKER_TRANSFER_BYTES).toBe(32 * 1024 * 1024);
  });

  it('uses the worker result only when its finite peak and gain are internally consistent', async () => {
    const service = createPeakMeasurementService({
      thresholdSamples: 1,
      workerFactory: () => fakeWorker((message, worker) => {
        const request = message as { id: number };
        worker.onmessage?.({
          data: { kind: 'peak-result', id: request.id, peak: 1.2, guardGain: OUTPUT_CEILING / 1.2 },
        } as MessageEvent);
      }),
    });

    await expect(service.measure(sourceFrom([[0.1, -0.4]]))).resolves.toEqual({
      peak: 1.2,
      guardGain: OUTPUT_CEILING / 1.2,
      mode: 'worker',
    });
  });

  it('falls back safely for malformed worker output, post errors, and a missing worker', async () => {
    const malformedService = createPeakMeasurementService({
      thresholdSamples: 1,
      workerFactory: () => fakeWorker((message, worker) => {
        const request = message as { id: number };
        worker.onmessage?.({ data: { kind: 'peak-result', id: request.id, peak: 'bad', guardGain: 1 } } as MessageEvent);
      }),
    });
    const malformedResult = await malformedService.measure(sourceFrom([[0.2, -1.4]]));
    expect(malformedResult.mode).toBe('main-thread');
    expect(malformedResult.peak).toBeCloseTo(1.4, 5);
    expect(malformedResult.guardGain).toBeCloseTo(OUTPUT_CEILING / 1.4, 5);

    const throwingService = createPeakMeasurementService({
      thresholdSamples: 1,
      workerFactory: () => ({
        onmessage: null,
        onerror: null,
        postMessage() { throw new Error('post failed'); },
        terminate: vi.fn(),
      }),
    });
    const postErrorResult = await throwingService.measure(sourceFrom([[0.1, -0.6]]));
    expect(postErrorResult.mode).toBe('main-thread');
    expect(postErrorResult.peak).toBeCloseTo(0.6, 5);
    expect(postErrorResult.guardGain).toBe(1);

    const unavailableService = createPeakMeasurementService({ thresholdSamples: 1, workerFactory: () => null });
    const unavailableResult = await unavailableService.measure(sourceFrom([[0.1, -0.6]]));
    expect(unavailableResult.mode).toBe('main-thread');
    expect(unavailableResult.peak).toBeCloseTo(0.6, 5);
    expect(unavailableResult.guardGain).toBe(1);
  });

  it('terminates a stalled worker and completes through the main-thread safety path', async () => {
    vi.useFakeTimers();
    try {
      const terminate = vi.fn();
      const service = createPeakMeasurementService({
        thresholdSamples: 1,
        timeoutMs: 25,
        workerFactory: () => ({
          onmessage: null,
          onerror: null,
          postMessage: vi.fn(),
          terminate,
        }),
      });
      const resultPromise = service.measure(sourceFrom([[0.1, -1.1]]));
      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(result.mode).toBe('main-thread');
      expect(result.peak).toBeCloseTo(1.1, 5);
      expect(result.guardGain).toBeCloseTo(OUTPUT_CEILING / 1.1, 5);
      expect(terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
