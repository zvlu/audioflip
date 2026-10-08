import { describe, expect, it, vi } from 'vitest';
import { decodeLocalFile } from '../src/audio/engine';
import { formatAttenuationPercent, outputDuration, peakGuardGain, peakOf, safeSample, validateTrim } from '../src/audio/math';
import { settingsForEffect } from '../src/audio/presets';
import { MAX_FILE_BYTES } from '../src/audio/types';
import { safeOfflineFrameLength, validateAudioBufferMetadata, validateEffectSettings } from '../src/audio/validation';
import { encodePcm16Wav, wavByteLength } from '../src/audio/wav';
import type { WavSource } from '../src/audio/types';

function fakeSource(channels: number[][], sampleRate = 44_100): WavSource {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData(channel: number) {
      return new Float32Array(channels[channel]);
    },
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

describe('trim and duration math', () => {
  it('rejects reversed, non-finite, out-of-range, and unusable clips', () => {
    expect(validateTrim({ start: 3, end: 2 }, 10)).toMatch(/later/);
    expect(validateTrim({ start: -0.1, end: 2 }, 10)).toMatch(/inside/);
    expect(validateTrim({ start: 0, end: 11 }, 10)).toMatch(/inside/);
    expect(validateTrim({ start: Number.NaN, end: 2 }, 10)).toMatch(/valid/);
    expect(validateTrim({ start: 0, end: 1 }, Number.POSITIVE_INFINITY)).toMatch(/usable/);
    expect(validateTrim({ start: 1, end: 2 }, 10)).toBeNull();
  });

  it('calculates nonzero-offset rate duration and full reverb tails', () => {
    expect(outputDuration({ start: 2, end: 10 }, 0.8, 1.2)).toBeCloseTo(11.2);
    expect(outputDuration({ start: 2, end: 10 }, 1.25)).toBeCloseTo(6.4);
    expect(outputDuration({ start: 0.25, end: 0.5 }, 0.65, 1.2)).toBeCloseTo(1.584615, 5);
    expect(outputDuration({ start: 2, end: 2 }, 1)).toBe(0);
    expect(outputDuration({ start: 0, end: 1 }, Number.NaN)).toBe(0);
  });
});

describe('render boundary validation', () => {
  it('accepts documented presets and rejects invalid effect controls', () => {
    expect(validateEffectSettings(settingsForEffect('original'))).toBeNull();
    expect(validateEffectSettings({ ...settingsForEffect('slowed'), rate: 0.65, reverbMix: 0 })).toBeNull();
    expect(validateEffectSettings({ ...settingsForEffect('slowed'), rate: 1, reverbMix: 0.4 })).toBeNull();
    expect(validateEffectSettings({ ...settingsForEffect('sped'), rate: 1.5 })).toBeNull();
    expect(validateEffectSettings({ ...settingsForEffect('nightcore'), rate: 1.6, brightness: false })).toBeNull();
    expect(validateEffectSettings({ ...settingsForEffect('bass'), bassGain: 12 })).toBeNull();
    expect(validateEffectSettings({ ...settingsForEffect('slowed'), rate: 0.64 })).toMatch(/0.65/);
    expect(validateEffectSettings({ ...settingsForEffect('bass'), rate: 1.25 })).toMatch(/fixed/);
    expect(validateEffectSettings({ ...settingsForEffect('sped'), reverbMix: Number.NaN })).toMatch(/finite/);
    expect(validateEffectSettings({ ...settingsForEffect('original'), effect: 'unknown' })).toMatch(/not supported/);
  });

  it('validates audio metadata and bounds offline allocations', () => {
    const valid = { duration: 10, length: 441_000, sampleRate: 44_100, numberOfChannels: 2 } as AudioBuffer;
    expect(validateAudioBufferMetadata(valid)).toBeNull();
    expect(validateAudioBufferMetadata({ ...valid, duration: 61 })).toMatch(/60-second/);
    expect(validateAudioBufferMetadata({ ...valid, sampleRate: Number.NaN })).toMatch(/sample rate/);
    expect(validateAudioBufferMetadata({ ...valid, numberOfChannels: 0 })).toMatch(/channel layout/);
    expect(safeOfflineFrameLength(93.6, 44_100, 2)).toBe(Math.ceil(93.6 * 44_100));
    expect(() => safeOfflineFrameLength(0, 44_100, 2)).toThrow(/positive/);
    expect(() => safeOfflineFrameLength(94, 192_000, 2)).toThrow(/memory/);
  });
});

describe('effect preset defaults', () => {
  it('restores every documented default instead of retaining a prior custom control', () => {
    expect(settingsForEffect('slowed')).toMatchObject({ rate: 0.8, reverbMix: 0.2, bassGain: 6, brightness: true });
    expect(settingsForEffect('sped')).toMatchObject({ rate: 1.25, reverbMix: 0.2, bassGain: 6, brightness: true });
    expect(settingsForEffect('nightcore')).toMatchObject({ rate: 1.35, reverbMix: 0.2, bassGain: 6, brightness: true });
    expect(settingsForEffect('bass')).toMatchObject({ rate: 1, reverbMix: 0.2, bassGain: 6, brightness: true });
  });
});

describe('peak guard and sample safety', () => {
  it('uses one finite shared gain and sanitizes extreme samples', () => {
    const source = fakeSource([[0, 0.25, -1.2, Number.NaN], [0.8, -0.2, Number.POSITIVE_INFINITY, -1.2]]);
    expect(peakOf(source)).toBeCloseTo(1.2);
    expect(peakGuardGain(1.2)).toBeCloseTo(0.98 / 1.2);
    expect(peakGuardGain(0.7)).toBe(1);
    expect(peakGuardGain(0)).toBe(1);
    expect(() => peakGuardGain(1.2, Number.NaN)).toThrow(/ceiling/);
    expect(safeSample(Number.NaN)).toBe(0);
    expect(safeSample(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(safeSample(1.4)).toBe(1);
    expect(safeSample(-1.4)).toBe(-1);
    expect(formatAttenuationPercent(0.999_999)).toBe('less than 0.01%');
    expect(formatAttenuationPercent(0.98)).toBe('2.00%');
  });
});

describe('decode boundary', () => {
  it('rejects oversized files before reading their data', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const oversized = { name: 'too-large.wav', size: MAX_FILE_BYTES + 1, arrayBuffer } as unknown as File;
    await expect(decodeLocalFile(oversized, {} as AudioContext)).rejects.toThrow(/too large/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe('PCM WAV export', () => {
  it('writes a valid mono RIFF/WAVE header, bounds samples, and has expected length', async () => {
    const source = fakeSource([[0, 0.5, -0.5, 2, Number.NaN]]);
    const blob = encodePcm16Wav(source);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe('audio/wav');
    expect(bytes.length).toBe(wavByteLength(source));
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44 + 6, true)).toBe(32_767);
    expect(view.getInt16(44 + 8, true)).toBe(0);
  });

  it('writes stereo frames interleaved with correct byte rate and full signed quantization', async () => {
    const source = fakeSource([[0.25, -1], [0.5, 1]], 48_000);
    const bytes = new Uint8Array(await encodePcm16Wav(source).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint32(28, true)).toBe(192_000);
    expect(view.getInt16(44, true)).toBe(Math.round(0.25 * 32_767));
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32_767));
    expect(view.getInt16(48, true)).toBe(-32_768);
    expect(view.getInt16(50, true)).toBe(32_767);
  });

  it('rejects unsafe metadata instead of silently coercing output', () => {
    expect(() => encodePcm16Wav({ ...fakeSource([[0]]), numberOfChannels: 3 })).toThrow(/one or two/);
    expect(() => encodePcm16Wav({ ...fakeSource([[0]]), sampleRate: 0 })).toThrow(/sample rate/);
    expect(() => encodePcm16Wav({ ...fakeSource([[0]]), length: -1 })).toThrow(/frame length/);
  });
});
