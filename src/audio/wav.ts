import { safeSample } from './math';
import type { WavSource } from './types';

const PCM_BITS = 16;
const PCM_BYTES = PCM_BITS / 8;

export function wavByteLength(source: WavSource): number {
  const channels = Math.max(1, Math.min(2, source.numberOfChannels));
  return 44 + source.length * channels * PCM_BYTES;
}

export function encodePcm16Wav(source: WavSource): Blob {
  const channels = Math.max(1, Math.min(2, source.numberOfChannels));
  const sampleRate = Math.round(source.sampleRate);
  const bytesPerFrame = channels * PCM_BYTES;
  const dataBytes = source.length * bytesPerFrame;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, PCM_BITS, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const data = Array.from({ length: channels }, (_, channel) => source.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < source.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = safeSample(data[channel]?.[frame] ?? 0);
      const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      view.setInt16(offset, pcm, true);
      offset += PCM_BYTES;
    }
  }

  return new Blob([view.buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
