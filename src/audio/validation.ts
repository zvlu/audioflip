import { MAX_DURATION_SECONDS } from './types';
import type { EffectId, EffectSettings } from './types';

export const MAX_SOURCE_SAMPLE_RATE = 192_000;
export const MAX_SOURCE_CHANNELS = 32;
export const MAX_RENDER_CHANNELS = 2;
export const MAX_RENDER_SAMPLES = 16_000_000;

const EFFECT_IDS: readonly EffectId[] = ['original', 'slowed', 'sped', 'nightcore', 'bass'];

export type AudioBufferMetadata = Pick<AudioBuffer, 'duration' | 'length' | 'sampleRate' | 'numberOfChannels'>;

export function isEffectId(value: unknown): value is EffectId {
  return typeof value === 'string' && EFFECT_IDS.includes(value as EffectId);
}

export function validateAudioBufferMetadata(
  source: AudioBufferMetadata,
  maximumDuration: number | null = MAX_DURATION_SECONDS,
): string | null {
  if (!Number.isFinite(source.duration) || source.duration <= 0) return 'The audio has no usable duration.';
  if (maximumDuration !== null && source.duration > maximumDuration) {
    return `This clip is longer than the ${maximumDuration}-second editor limit.`;
  }
  if (!Number.isInteger(source.length) || source.length <= 0) return 'The audio has no usable sample data.';
  if (!Number.isFinite(source.sampleRate) || source.sampleRate <= 0 || source.sampleRate > MAX_SOURCE_SAMPLE_RATE) {
    return `This audio has an unsupported sample rate. AudioFlip supports source rates up to ${MAX_SOURCE_SAMPLE_RATE.toLocaleString()} Hz.`;
  }
  if (!Number.isInteger(source.numberOfChannels) || source.numberOfChannels < 1 || source.numberOfChannels > MAX_SOURCE_CHANNELS) {
    return `This audio has an unsupported channel layout. AudioFlip supports 1–${MAX_SOURCE_CHANNELS} source channels.`;
  }
  return null;
}

export function validateEffectSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return 'Effect settings are missing.';
  const candidate = settings as Partial<EffectSettings>;
  if (!isEffectId(candidate.effect)) return 'The selected audio effect is not supported.';
  const rate = candidate.rate;
  const reverbMix = candidate.reverbMix;
  const bassGain = candidate.bassGain;
  if (typeof rate !== 'number' || typeof reverbMix !== 'number' || typeof bassGain !== 'number'
    || !Number.isFinite(rate) || !Number.isFinite(reverbMix) || !Number.isFinite(bassGain)) {
    return 'Effect controls must be finite numbers.';
  }
  if (typeof candidate.brightness !== 'boolean') return 'Brightness must be enabled or disabled.';
  if (reverbMix < 0 || reverbMix > 0.4) return 'Reverb wet mix must stay between 0% and 40%.';
  if (bassGain < 0 || bassGain > 12) return 'Bass boost must stay between 0 and 12 dB.';

  if (candidate.effect === 'slowed' && (rate < 0.65 || rate > 1)) {
    return 'Slowed playback speed must stay between 0.65× and 1.00×.';
  }
  if (candidate.effect === 'sped' && (rate < 1 || rate > 1.5)) {
    return 'Sped-up playback speed must stay between 1.00× and 1.50×.';
  }
  if (candidate.effect === 'nightcore' && (rate < 1.1 || rate > 1.6)) {
    return 'Nightcore-style playback speed must stay between 1.10× and 1.60×.';
  }
  if ((candidate.effect === 'original' || candidate.effect === 'bass') && rate !== 1) {
    return 'Original and Bass boost use a fixed 1.00× playback rate.';
  }
  return null;
}

export function renderOutputChannels(sourceChannels: number): number {
  return sourceChannels === 1 ? 1 : MAX_RENDER_CHANNELS;
}

/** Throws before a browser allocates an unusable OfflineAudioContext buffer. */
export function safeOfflineFrameLength(duration: number, sampleRate: number, channels: number): number {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Output duration must be a positive finite number.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > MAX_SOURCE_SAMPLE_RATE) {
    throw new Error('Output sample rate is not safe for offline rendering.');
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > MAX_RENDER_CHANNELS) {
    throw new Error('Output channel layout is not safe for offline rendering.');
  }

  const frames = Math.ceil(duration * sampleRate);
  const samples = frames * channels;
  if (!Number.isSafeInteger(frames) || frames < 1 || !Number.isSafeInteger(samples) || samples > MAX_RENDER_SAMPLES) {
    throw new Error('This render would allocate more audio memory than AudioFlip allows. Try a shorter clip or lower source sample rate.');
  }
  return frames;
}
