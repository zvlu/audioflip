import { describe, expect, it, vi } from 'vitest';
import { makeSafeBuffer } from '../src/audio/engine';

type BufferShape = {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
};

function bufferFrom(channels: number[][]): BufferShape {
  const data = channels.map((channel) => new Float32Array(channel));
  return {
    length: data[0]?.length ?? 0,
    numberOfChannels: data.length,
    sampleRate: 44_100,
    getChannelData(channel: number) {
      return data[channel];
    },
  };
}

describe('safe buffer allocation fallback', () => {
  it('uses the existing offline-context allocator when the global AudioBuffer allocation fails', () => {
    const source = bufferFrom([[1.4, Number.NaN, -0.5]]);
    const fallbackOutput = bufferFrom([[0, 0, 0]]);
    const primary = vi.fn(() => { throw new Error('global allocation failed'); });
    const fallback = vi.fn(() => fallbackOutput as unknown as AudioBuffer);

    const safe = makeSafeBuffer(source as unknown as AudioBuffer, 0.5, { primary, fallback });

    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(1, 3, 44_100);
    expect(safe).toBe(fallbackOutput);
    const samples = fallbackOutput.getChannelData(0);
    expect(samples[0]).toBeCloseTo(0.7, 5);
    expect(samples[1]).toBe(0);
    expect(samples[2]).toBeCloseTo(-0.25, 5);
  });

  it('rejects an invalid allocation shape or two allocator failures instead of exporting unsafe audio', () => {
    const source = bufferFrom([[0.5, -0.5]]);
    const malformed = bufferFrom([[0, 0, 0]]);
    const fallback = vi.fn(() => { throw new Error('context allocation failed'); });

    expect(() => makeSafeBuffer(source as unknown as AudioBuffer, 1, {
      primary: () => malformed as unknown as AudioBuffer,
      fallback,
    })).toThrow('could not allocate a safe output buffer');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
