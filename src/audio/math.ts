import type { TrimRange, WavSource } from './types';

export const OUTPUT_CEILING = 0.98;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function validateTrim(trim: TrimRange, duration: number): string | null {
  if (!Number.isFinite(trim.start) || !Number.isFinite(trim.end)) {
    return 'Trim points must be valid numbers.';
  }
  if (trim.start < 0 || trim.end > duration) {
    return 'Trim points must stay inside the loaded clip.';
  }
  if (trim.end <= trim.start) {
    return 'Trim end must be later than trim start.';
  }
  return null;
}

export function outputDuration(trim: TrimRange, rate: number, reverbTail = 0): number {
  if (!Number.isFinite(rate) || rate <= 0 || trim.end <= trim.start) return 0;
  return Math.max(0, (trim.end - trim.start) / rate + Math.max(0, reverbTail));
}

export function peakOf(source: WavSource): number {
  let peak = 0;
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const data = source.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index];
      if (!Number.isFinite(sample)) continue;
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return peak;
}

export function peakGuardGain(peak: number, ceiling = OUTPUT_CEILING): number {
  if (!Number.isFinite(peak) || peak <= 0 || peak <= ceiling) return 1;
  return ceiling / peak;
}

export function safeSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, -1, 1);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - wholeMinutes * 60;
  return `${wholeMinutes}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
}
