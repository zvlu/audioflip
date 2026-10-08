export type EffectId = 'original' | 'slowed' | 'sped' | 'nightcore' | 'bass';

export interface EffectSettings {
  effect: EffectId;
  rate: number;
  reverbMix: number;
  bassGain: number;
  brightness: boolean;
}

export interface TrimRange {
  start: number;
  end: number;
}

export interface RenderedAudio {
  buffer: AudioBuffer;
  peak: number;
  guardGain: number;
  duration: number;
}

export interface WavSource {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 60;
export const WAV_TARGET_SAMPLE_RATE = 44_100;
