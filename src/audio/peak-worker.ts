type PeakWorkerRequest = {
  kind: 'scan-peak';
  id: number;
  ceiling: number;
  channels: ArrayBuffer[];
};

type PeakWorkerResult = {
  kind: 'peak-result';
  id: number;
  peak: number;
  guardGain: number;
};

type PeakWorkerFailure = {
  kind: 'peak-error';
  id: number;
  message: string;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<PeakWorkerRequest>) => void) | null;
  postMessage: (message: PeakWorkerResult | PeakWorkerFailure) => void;
};

const workerScope = self as unknown as WorkerScope;

function finitePeak(channels: readonly ArrayBuffer[]): number {
  let peak = 0;
  for (const channelBuffer of channels) {
    if (!(channelBuffer instanceof ArrayBuffer) || channelBuffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error('Peak worker received invalid channel data.');
    }
    const samples = new Float32Array(channelBuffer);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (!Number.isFinite(sample)) continue;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request?.kind !== 'scan-peak' || !Number.isSafeInteger(request.id) || request.id < 1) return;

  try {
    if (!Number.isFinite(request.ceiling) || request.ceiling <= 0 || request.ceiling > 1) {
      throw new Error('Peak worker received an invalid ceiling.');
    }
    if (!Array.isArray(request.channels) || request.channels.length === 0) {
      throw new Error('Peak worker received no channel data.');
    }

    const peak = finitePeak(request.channels);
    const guardGain = peak > request.ceiling && peak > 0 ? request.ceiling / peak : 1;
    workerScope.postMessage({ kind: 'peak-result', id: request.id, peak, guardGain });
  } catch (reason) {
    workerScope.postMessage({
      kind: 'peak-error',
      id: request.id,
      message: reason instanceof Error ? reason.message : 'Peak worker failed.',
    });
  }
};
