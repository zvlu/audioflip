import { describe, expect, it, vi } from 'vitest';
import { playRenderedBuffer, playSourceRange } from '../src/audio/engine';

function fakeBuffer(duration = 4): AudioBuffer {
  return {
    duration,
    length: duration * 44_100,
    sampleRate: 44_100,
    numberOfChannels: 1,
  } as AudioBuffer;
}

function runningContext() {
  const source = {
    buffer: null as AudioBuffer | null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const context = {
    state: 'running',
    destination: {},
    createBufferSource: vi.fn(() => source),
  } as unknown as AudioContext;

  return { context, source };
}

describe('preview loop playback', () => {
  it('keeps default source previews one-shot', () => {
    const { context, source } = runningContext();

    playSourceRange(context, fakeBuffer(), { start: 0.5, end: 2.25 }, vi.fn());

    expect(source.loop).toBe(false);
    expect(source.start).toHaveBeenCalledWith(0, 0.5, 1.75);
  });

  it('loops exactly within the selected original trim range', () => {
    const { context, source } = runningContext();

    const handle = playSourceRange(context, fakeBuffer(), { start: 0.5, end: 2.25 }, vi.fn(), { loop: true });

    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0.5);
    expect(source.loopEnd).toBe(2.25);
    expect(source.start).toHaveBeenCalledWith(0, 0.5);

    handle.stop();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
  });

  it('loops the complete rendered buffer without a one-pass duration', () => {
    const { context, source } = runningContext();

    playRenderedBuffer(context, fakeBuffer(3.5), vi.fn(), { loop: true });

    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0);
    expect(source.loopEnd).toBe(3.5);
    expect(source.start).toHaveBeenCalledWith(0, 0);
  });
});
