// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  decode: vi.fn(),
  render: vi.fn(),
  stop: vi.fn(),
  createUrl: vi.fn(() => 'blob:audioflip-test'),
  revokeUrl: vi.fn(),
}));

vi.mock('../src/audio/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/audio/engine')>();
  return {
    ...actual,
    getAudioContext: vi.fn(() => ({ state: 'running', close: vi.fn(async () => undefined) })),
    enableAudio: vi.fn(async () => undefined),
    decodeLocalFile: mockState.decode,
    renderEffect: mockState.render,
    playSourceRange: vi.fn(() => ({ stop: mockState.stop })),
    playRenderedBuffer: vi.fn(() => ({ stop: mockState.stop })),
  };
});

import App from '../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function fakeBuffer(duration = 1): AudioBuffer {
  const sampleRate = 44_100;
  const length = Math.round(duration * sampleRate);
  const samples = new Float32Array(length);
  return {
    duration,
    length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

async function waitFor(predicate: () => boolean, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await Promise.resolve(); });
  }
  throw new Error('Timed out waiting for expected UI state.');
}

async function upload(file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Audio input not found.');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

function namedButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

beforeEach(() => {
  mockState.decode.mockReset();
  mockState.render.mockReset();
  mockState.stop.mockReset();
  mockState.createUrl.mockClear();
  mockState.revokeUrl.mockClear();
  Object.assign(URL, { createObjectURL: mockState.createUrl, revokeObjectURL: mockState.revokeUrl });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AudioFlip editor lifecycle', () => {
  it('keeps Reset source-only, revokes rendered URLs on Clear, and ignores late decode completion', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const source = fakeBuffer();
    const firstRender = deferred<{ buffer: AudioBuffer; peak: number; guardGain: number; duration: number }>();
    const lateDecode = deferred<AudioBuffer>();
    mockState.decode.mockResolvedValueOnce(source).mockReturnValueOnce(lateDecode.promise);
    mockState.render.mockReturnValueOnce(firstRender.promise);

    await act(async () => { root.render(<App />); });
    await upload(new File(['first'], 'first.wav', { type: 'audio/wav' }));
    await waitFor(() => document.querySelector('.source-meta strong')?.textContent === 'first.wav');

    await act(async () => { namedButton('Render WAV').click(); });
    await act(async () => { firstRender.resolve({ buffer: fakeBuffer(), peak: 1, guardGain: 0.98, duration: 1 }); });
    await waitFor(() => Boolean(document.querySelector('.result-card')));

    await act(async () => { namedButton('Reset neutral').click(); });
    expect(document.querySelector('.source-meta strong')?.textContent).toBe('first.wav');
    expect(document.querySelector('.result-card')).toBeNull();
    expect(mockState.revokeUrl).toHaveBeenCalledWith('blob:audioflip-test');

    const secondRender = deferred<{ buffer: AudioBuffer; peak: number; guardGain: number; duration: number }>();
    mockState.render.mockReturnValueOnce(secondRender.promise);
    await act(async () => { namedButton('Render WAV').click(); });
    await act(async () => { secondRender.resolve({ buffer: fakeBuffer(), peak: 1, guardGain: 0.98, duration: 1 }); });
    await waitFor(() => Boolean(document.querySelector('.result-card')));

    await upload(new File(['second'], 'second.wav', { type: 'audio/wav' }));
    await waitFor(() => Boolean(document.querySelector('.message.status')?.textContent?.includes('Loading')));
    await act(async () => { namedButton('Clear clip').click(); });
    expect(mockState.revokeUrl).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.source-meta strong')?.textContent).toBe('No source loaded');
    expect(document.querySelector('.result-card')).toBeNull();

    await act(async () => { lateDecode.resolve(fakeBuffer()); });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('.source-meta strong')?.textContent).toBe('No source loaded');
    expect(document.querySelector('.result-card')).toBeNull();

    await act(async () => { root.unmount(); });
    host.remove();
  });
});
