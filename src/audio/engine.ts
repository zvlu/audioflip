import { clamp, outputDuration, peakGuardGain, peakOf, safeSample, validateTrim } from './math';
import { WAV_TARGET_SAMPLE_RATE } from './types';
import type { EffectId, EffectSettings, RenderedAudio, TrimRange } from './types';

export interface PlaybackHandle {
  stop: () => void;
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
  if (context.state !== 'running') await context.resume();
}

export async function decodeLocalFile(file: File, context: AudioContext): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  try {
    const decoded = await context.decodeAudioData(data.slice(0));
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      throw new Error('The audio has no usable duration.');
    }
    return decoded;
  } catch {
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
): Promise<RenderedAudio> {
  const trimError = validateTrim(trim, sourceBuffer.duration);
  if (trimError) throw new Error(trimError);

  const rate = activeRate(settings);
  const tailSeconds = settings.effect === 'slowed' && settings.reverbMix > 0 ? 1.2 : 0;
  const duration = outputDuration(trim, rate, tailSeconds);
  const channels = sourceBuffer.numberOfChannels === 1 ? 1 : 2;
  const preferredRate = WAV_TARGET_SAMPLE_RATE;
  let offline: OfflineAudioContext;

  try {
    offline = new OfflineAudioContext(channels, Math.ceil(duration * preferredRate), preferredRate);
  } catch {
    offline = new OfflineAudioContext(channels, Math.ceil(duration * sourceBuffer.sampleRate), sourceBuffer.sampleRate);
  }

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = rate;
  const master = offline.createGain();
  master.gain.value = 1;

  connectEffect(source, master, offline, settings);
  master.connect(offline.destination);
  source.start(0, trim.start, trim.end - trim.start);

  const rendered = await offline.startRendering();
  const peak = peakOf(rendered);
  const guardGain = peakGuardGain(peak);
  const safeBuffer = makeSafeBuffer(rendered, guardGain);

  return {
    buffer: safeBuffer,
    peak,
    guardGain,
    duration: safeBuffer.duration,
  };
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
    const mix = clamp(settings.reverbMix, 0, 0.4);
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
    bass.gain.value = clamp(settings.bassGain, 0, 12);
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

function makeSafeBuffer(source: AudioBuffer, gain: number): AudioBuffer {
  const output = new AudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });
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
): PlaybackHandle {
  const trimError = validateTrim(trim, buffer.duration);
  if (trimError) throw new Error(trimError);
  return playBuffer(context, buffer, trim.start, trim.end - trim.start, onEnded);
}

export function playRenderedBuffer(
  context: AudioContext,
  buffer: AudioBuffer,
  onEnded: () => void,
): PlaybackHandle {
  return playBuffer(context, buffer, 0, buffer.duration, onEnded);
}

function playBuffer(
  context: AudioContext,
  buffer: AudioBuffer,
  start: number,
  duration: number,
  onEnded: () => void,
): PlaybackHandle {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  let stopped = false;
  source.onended = () => {
    if (!stopped) onEnded();
  };
  source.start(0, start, duration);
  return {
    stop: () => {
      stopped = true;
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A stopped one-shot source cannot be stopped again; cleanup is already complete.
      }
      source.disconnect();
    },
  };
}
