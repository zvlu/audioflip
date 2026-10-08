import { safeSample } from './math';
import type { WavSource } from './types';

const PCM_BITS = 16;
const PCM_BYTES = PCM_BITS / 8;
const MAX_WAV_DATA_BYTES = 256 * 1024 * 1024;

type ValidatedWavSource = {
  channels: number;
  sampleRate: number;
  dataBytes: number;
  bytesPerFrame: number;
  channelData: Float32Array[];
};

export function wavByteLength(source: WavSource): number {
  const metadata = validateWavSource(source);
  return 44 + metadata.dataBytes;
}

export function encodePcm16Wav(source: WavSource): Blob {
  const { channels, sampleRate, dataBytes, bytesPerFrame, channelData } = validateWavSource(source);
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

  let offset = 44;
  for (let frame = 0; frame < source.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = safeSample(channelData[channel][frame]);
      const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      view.setInt16(offset, pcm, true);
      offset += PCM_BYTES;
    }
  }

  return new Blob([view.buffer], { type: 'audio/wav' });
}

function validateWavSource(source: WavSource): ValidatedWavSource {
  if (!Number.isInteger(source.numberOfChannels) || source.numberOfChannels < 1 || source.numberOfChannels > 2) {
    throw new Error('PCM WAV export supports one or two channels.');
  }
  if (!Number.isInteger(source.length) || source.length < 0) {
    throw new Error('PCM WAV export requires a valid frame length.');
  }
  if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0 || source.sampleRate > 192_000) {
    throw new Error('PCM WAV export requires a sample rate from 1 to 192000 Hz.');
  }

  const channels = source.numberOfChannels;
  const sampleRate = Math.round(source.sampleRate);
  const bytesPerFrame = channels * PCM_BYTES;
  const dataBytes = source.length * bytesPerFrame;
  if (!Number.isSafeInteger(dataBytes) || dataBytes > MAX_WAV_DATA_BYTES || 36 + dataBytes > 0xffff_ffff) {
    throw new Error('PCM WAV export would exceed AudioFlip’s safe output allocation.');
  }
  if (!Number.isSafeInteger(sampleRate * bytesPerFrame) || sampleRate * bytesPerFrame > 0xffff_ffff) {
    throw new Error('PCM WAV byte rate is not representable.');
  }

  const channelData = Array.from({ length: channels }, (_, channel) => source.getChannelData(channel));
  if (channelData.some((data) => !(data instanceof Float32Array) || data.length < source.length)) {
    throw new Error('PCM WAV export received incomplete channel data.');
  }
  return { channels, sampleRate, dataBytes, bytesPerFrame, channelData };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
