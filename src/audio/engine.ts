import { outputDuration, safeSample, validateTrim } from './math';
import { measurePeakWithFallback } from './peak-service';
import { MAX_FILE_BYTES, WAV_TARGET_SAMPLE_RATE } from './types';
import { renderOutputChannels, safeOfflineFrameLength, validateAudioBufferMetadata, validateEffectSettings } from './validation';
import type { EffectId, EffectSettings, RenderedAudio, TrimRange } from './types';

const REVERB_TAIL_SECONDS = 1.2;

type OfflineAudioContextConstructor = new (numberOfChannels: number, length: number, sampleRate: number) => OfflineAudioContext;

export type AudioBufferAllocator = (numberOfChannels: number, length: number, sampleRate: number) => AudioBuffer;

export type SafeBufferAllocators = {
  primary?: AudioBufferAllocator;
  fallback?: AudioBufferAllocator;
};

export class AudioRenderCancelledError extends Error {
  constructor() {
    super('Audio rendering was cancelled.');
    this.name = 'AudioRenderCancelledError';
  }
}

export interface PlaybackHandle {
  stop: () => void;
}

export interface PlaybackOptions {
  loop?: boolean;
}

export function getAudioContext(): AudioContext {
  const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = window.AudioContext ?? audioWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('This browser does not support the Web Audio API needed for AudioFlip.');
  }
  return new AudioContextConstructor();
}

export async function enableAudio(context: AudioContext): Promise<void> {
  if (context.state === 'closed') throw new Error('The audio session was closed. Tap again to create a new one.');
  if (context.state !== 'running') await context.resume();
  if (context.state !== 'running') {
    throw new Error('Audio playback is still blocked or interrupted. Tap a preview button and allow sound for this page.');
  }
}

export async function decodeLocalFile(file: File, context: AudioContext): Promise<AudioBuffer> {
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('This file is empty. Choose a WAV or MP3 with audio data.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`This file is too large. AudioFlip accepts clips up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const data = await file.arrayBuffer();
  if (data.byteLength === 0) throw new Error('This file is empty. Choose a WAV or MP3 with audio data.');
  if (data.byteLength > MAX_FILE_BYTES) throw new Error(`This file is too large. AudioFlip accepts clips up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);

  try {
    const decoded = await context.decodeAudioData(data);
    const metadataError = validateAudioBufferMetadata(decoded);
    if (metadataError) throw new Error(metadataError);
    return decoded;
  } catch (reason) {
    if (reason instanceof Error && /usable|editor limit|sample rate|channel layout/.test(reason.message)) throw reason;
    throw new Error('This file could not be decoded here. Try a WAV or MP3 that plays in this browser.');
  }
}

export function effectLabel(effect: EffectId): string {
  return {
    original: 'original',
    slowed: 'slowed-reverb',
    sped: 'sped-up',
    nightcore: 'nightcore-style',
    bass: 'bass-boost',
  }[effect];
}

export function activeRate(settings: EffectSettings): number {
  return settings.effect === 'bass' || settings.effect === 'original' ? 1 : settings.rate;
}

export async function renderEffect(
  sourceBuffer: AudioBuffer,
  trim: TrimRange,
  settings: EffectSettings,
  signal?: AbortSignal,
): Promise<RenderedAudio> {
  throwIfRenderCancelled(signal);
  const metadataError = validateAudioBufferMetadata(sourceBuffer);
  if (metadataError) throw new Error(metadataError);
  const settingsError = validateEffectSettings(settings);
  if (settingsError) throw new Error(settingsError);
  const trimError = validateTrim(trim, sourceBuffer.duration);
  if (trimError) throw new Error(trimError);

  const rate = activeRate(settings);
  const tailSeconds = settings.effect === 'slowed' && settings.reverbMix > 0 ? REVERB_TAIL_SECONDS : 0;
  const duration = outputDuration(trim, rate, tailSeconds);
  const channels = renderOutputChannels(sourceBuffer.numberOfChannels);
  const offline = createOfflineContext(channels, duration, sourceBuffer.sampleRate);

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;
  source.channelCount = channels;
  source.channelCountMode = 'explicit';
  source.playbackRate.value = rate;
  const master = offline.createGain();
  master.gain.value = 1;

  connectEffect(source, master, offline, settings);
  master.connect(offline.destination);
  source.start(0, trim.start, trim.end - trim.start);

  let rendered: AudioBuffer;
  try {
    rendered = await offline.startRendering();
  } catch {
    throwIfRenderCancelled(signal);
    throw new Error('AudioFlip could not finish this local render. Try a shorter clip or another browser-supported source.');
  }

  throwIfRenderCancelled(signal);
  const renderedMetadataError = validateAudioBufferMetadata(rendered, null);
  if (renderedMetadataError) throw new Error(renderedMetadataError);
  const { peak, guardGain } = await measurePeakWithFallback(rendered, signal);
  throwIfRenderCancelled(signal);
  const safeBuffer = makeSafeBuffer(rendered, guardGain, {
    fallback: (numberOfChannels, length, sampleRate) => offline.createBuffer(numberOfChannels, length, sampleRate),
  });
  throwIfRenderCancelled(signal);

  return {
    buffer: safeBuffer,
    peak,
    guardGain,
    duration: safeBuffer.duration,
  };
}

function createOfflineContext(channels: number, duration: number, sourceRate: number): OfflineAudioContext {
  const audioWindow = window as typeof window & { webkitOfflineAudioContext?: OfflineAudioContextConstructor };
  const OfflineContext = window.OfflineAudioContext ?? audioWindow.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error('This browser does not support offline audio rendering needed for WAV export.');

  try {
    const preferredFrames = safeOfflineFrameLength(duration, WAV_TARGET_SAMPLE_RATE, channels);
    return new OfflineContext(channels, preferredFrames, WAV_TARGET_SAMPLE_RATE);
  } catch {
    try {
      const fallbackFrames = safeOfflineFrameLength(duration, sourceRate, channels);
      return new OfflineContext(channels, fallbackFrames, sourceRate);
    } catch {
      throw new Error('AudioFlip could not allocate a safe offline render at this sample rate. Try a shorter clip or lower-rate source.');
    }
  }
}

function connectEffect(
  source: AudioBufferSourceNode,
  master: GainNode,
  context: OfflineAudioContext,
  settings: EffectSettings,
): void {
  if (settings.effect === 'slowed') {
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    const mix = settings.reverbMix;
    dry.gain.value = 1 - mix * 0.55;
    wet.gain.value = mix;
    convolver.buffer = makeImpulse(context, 1.15);
    source.connect(dry).connect(master);
    source.connect(convolver).connect(wet).connect(master);
    return;
  }

  if (settings.effect === 'nightcore') {
    const brightness = context.createBiquadFilter();
    brightness.type = 'highshelf';
    brightness.frequency.value = 4_700;
    brightness.gain.value = settings.brightness ? 1.8 : 0;
    source.connect(brightness).connect(master);
    return;
  }

  if (settings.effect === 'bass') {
    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 120;
    bass.gain.value = settings.bassGain;
    source.connect(bass).connect(master);
    return;
  }

  source.connect(master);
}

function makeImpulse(context: BaseAudioContext, duration: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  let seed = 193;
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      const noise = seed / 1_073_741_823.5 - 1;
      data[index] = noise * Math.pow(1 - index / length, 2.3);
    }
  }
  return impulse;
}

function throwIfRenderCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AudioRenderCancelledError();
}

export function makeSafeBuffer(source: AudioBuffer, gain: number, allocators: SafeBufferAllocators = {}): AudioBuffer {
  if (!Number.isFinite(gain) || gain <= 0 || gain > 1) {
    throw new Error('AudioFlip could not apply a safe output gain.');
  }

  const primary = allocators.primary ?? ((numberOfChannels, length, sampleRate) => new AudioBuffer({
    length,
    numberOfChannels,
    sampleRate,
  }));
  const candidates = [primary, allocators.fallback].filter((allocator): allocator is AudioBufferAllocator => Boolean(allocator));
  let output: AudioBuffer | null = null;
  for (const allocate of candidates) {
    try {
      const candidate = allocate(source.numberOfChannels, source.length, source.sampleRate);
      if (candidate.length !== source.length || candidate.numberOfChannels !== source.numberOfChannels || candidate.sampleRate !== source.sampleRate) {
        continue;
      }
      output = candidate;
      break;
    } catch {
      // A browser can reject the global constructor while an existing OfflineAudioContext can still allocate a buffer.
    }
  }
  if (!output) throw new Error('AudioFlip could not allocate a safe output buffer. Try a shorter clip or another browser.');

  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const from = source.getChannelData(channel);
    const to = output.getChannelData(channel);
    for (let index = 0; index < source.length; index += 1) {
      to[index] = safeSample(from[index] * gain);
    }
  }
  return output;
}

export function playSourceRange(
  context: AudioContext,
  buffer: AudioBuffer,
  trim: TrimRange,
  onEnded: () => void,
  options: PlaybackOptions = {},
): PlaybackHandle {
  const metadataError = validateAudioBufferMetadata(buffer);
  if (metadataError) throw new Error(metadataError);
  const trimError = validateTrim(trim, buffer.duration);
  if (trimError) throw new Error(trimError);
  return playBuffer(context, buffer, trim.start, trim.end - trim.start, onEnded, {
    loop: options.loop,
    loopStart: trim.start,
    loopEnd: trim.end,
  });
}

export function playRenderedBuffer(
  context: AudioContext,
  buffer: AudioBuffer,
  onEnded: () => void,
  options: PlaybackOptions = {},
): PlaybackHandle {
  const metadataError = validateAudioBufferMetadata(buffer, null);
  if (metadataError) throw new Error(metadataError);
  return playBuffer(context, buffer, 0, buffer.duration, onEnded, {
    loop: options.loop,
    loopStart: 0,
    loopEnd: buffer.duration,
  });
}

function playBuffer(
  context: AudioContext,
  buffer: AudioBuffer,
  start: number,
  duration: number,
  onEnded: () => void,
  options: PlaybackOptions & { loopStart?: number; loopEnd?: number } = {},
): PlaybackHandle {
  if (context.state !== 'running') throw new Error('Audio is not running yet. Tap again to enable playback.');
  if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0) {
    throw new Error('This preview range is not valid.');
  }

  const loop = options.loop === true;
  const loopStart = options.loopStart ?? start;
  const loopEnd = options.loopEnd ?? start + duration;
  if (loop && (
    !Number.isFinite(loopStart)
    || !Number.isFinite(loopEnd)
    || loopStart < 0
    || loopEnd <= loopStart
    || loopEnd > buffer.duration
  )) {
    throw new Error('This preview loop range is not valid.');
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  if (loop) {
    source.loopStart = loopStart;
    source.loopEnd = loopEnd;
  }
  source.connect(context.destination);
  let stopped = false;
  let ended = false;
  const dispose = (): void => {
    source.onended = null;
    try {
      source.disconnect();
    } catch {
      // Source cleanup is best-effort after browser-driven natural completion.
    }
  };

  source.onended = () => {
    if (stopped || ended) return;
    ended = true;
    dispose();
    onEnded();
  };

  try {
    if (loop) source.start(0, start);
    else source.start(0, start, duration);
  } catch (reason) {
    dispose();
    throw reason;
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      dispose();
      try {
        source.stop();
      } catch {
        // A one-shot source may already have ended; it is still disposed above.
      }
    },
  };
}
