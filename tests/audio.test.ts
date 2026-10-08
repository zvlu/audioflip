import { describe, expect, it } from 'vitest';
import { outputDuration, peakGuardGain, peakOf, validateTrim } from '../src/audio/math';
import { settingsForEffect } from '../src/audio/presets';
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
  it('rejects reversed and out-of-range trims', () => {
    expect(validateTrim({ start: 3, end: 2 }, 10)).toMatch(/later/);
    expect(validateTrim({ start: -0.1, end: 2 }, 10)).toMatch(/inside/);
    expect(validateTrim({ start: 0, end: 11 }, 10)).toMatch(/inside/);
    expect(validateTrim({ start: 1, end: 2 }, 10)).toBeNull();
  });

  it('calculates rate-adjusted output duration and reverb tail', () => {
    expect(outputDuration({ start: 2, end: 10 }, 0.8, 1.2)).toBeCloseTo(11.2);
    expect(outputDuration({ start: 2, end: 10 }, 1.25)).toBeCloseTo(6.4);
    expect(outputDuration({ start: 2, end: 2 }, 1)).toBe(0);
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

describe('peak guard', () => {
  it('measures finite peaks and selects a safe gain', () => {
    const source = fakeSource([[0, 0.25, -1.2, Number.NaN]]);
    expect(peakOf(source)).toBeCloseTo(1.2);
    expect(peakGuardGain(1.2)).toBeCloseTo(0.98 / 1.2);
    expect(peakGuardGain(0.7)).toBe(1);
    expect(peakGuardGain(0)).toBe(1);
  });
});

describe('PCM WAV export', () => {
  it('writes a valid mono RIFF/WAVE header and expected length', async () => {
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
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44 + 6, true)).toBe(32_767);
    expect(view.getInt16(44 + 8, true)).toBe(0);
  });

  it('writes stereo frames interleaved', async () => {
    const source = fakeSource([[0.25, -0.25], [0.5, -0.5]], 48_000);
    const bytes = new Uint8Array(await encodePcm16Wav(source).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getInt16(44, true)).toBe(Math.round(0.25 * 32_767));
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32_767));
  });
});
