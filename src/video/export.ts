export const VIDEO_DURATION_CAP_SECONDS = 60;
export const MIN_VIDEO_DURATION_SECONDS = 1;

export type VideoMimeOption = {
  mimeType: 'video/mp4' | 'video/webm;codecs=vp9,opus' | 'video/webm';
  extension: 'mp4' | 'webm';
};

export type VerticalCanvasSize = { width: 720 | 1080; height: 1280 | 1920 };

export type VideoExportSupport = {
  supported: boolean;
  option?: VideoMimeOption;
  reason?: string;
};

export type VideoExportArtifact = {
  blob: Blob;
  mimeType: VideoMimeOption['mimeType'];
  extension: VideoMimeOption['extension'];
  duration: number;
  width: number;
  height: number;
};

export type VideoExportJob = {
  promise: Promise<VideoExportArtifact>;
  cancel: () => void;
};

export type VerticalVideoExportOptions = {
  context: AudioContext;
  buffer: AudioBuffer;
  effectName: string;
  title: string;
  onProgress?: (progress: number) => void;
};

type CaptureCanvas = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

const VIDEO_MIME_OPTIONS: readonly VideoMimeOption[] = [
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

export function selectVideoMimeType(isTypeSupported: (mimeType: string) => boolean): VideoMimeOption | null {
  return VIDEO_MIME_OPTIONS.find((option) => isTypeSupported(option.mimeType)) ?? null;
}

export function sanitizeVideoTitle(value: string, fallback = 'AudioFlip'): string {
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidate = cleaned || fallback.replace(/\s+/g, ' ').trim() || 'AudioFlip';
  return Array.from(candidate).slice(0, 40).join('');
}

export function titleFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^/.]+$/, '');
  return sanitizeVideoTitle(withoutExtension || filename, 'AudioFlip');
}

export function captionForEffect(effectName: string): string {
  return `${effectName.trim().toLowerCase()} version - made with AudioFlip`;
}

export function chooseVerticalCanvasSize(profile: { hardwareConcurrency?: number; deviceMemory?: number } = {}): VerticalCanvasSize {
  const threads = profile.hardwareConcurrency;
  const memory = profile.deviceMemory;
  const lowerPower = (Number.isFinite(threads) && (threads ?? 0) > 0 && (threads ?? 0) <= 4)
    || (Number.isFinite(memory) && (memory ?? 0) > 0 && (memory ?? 0) <= 4);
  return lowerPower ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
}

function supportedMimeOptions(): VideoMimeOption[] {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return [];
  if (typeof window.MediaRecorder.isTypeSupported !== 'function') return [];
  return VIDEO_MIME_OPTIONS.filter((option) => window.MediaRecorder.isTypeSupported(option.mimeType));
}

export function getVideoExportSupport(): VideoExportSupport {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return { supported: false, reason: 'Video export is not available in this browser because MediaRecorder is missing.' };
  }
  const captureStream = (HTMLCanvasElement.prototype as CaptureCanvas).captureStream;
  if (typeof captureStream !== 'function') {
    return { supported: false, reason: 'Video export is not available in this browser because canvas recording is missing.' };
  }
  const option = selectVideoMimeType((mimeType) => window.MediaRecorder.isTypeSupported?.(mimeType) ?? false);
  if (!option) {
    return { supported: false, reason: 'This browser does not report a supported MP4 or WebM recording format.' };
  }
  return { supported: true, option };
}

function createRecorder(stream: MediaStream): { recorder: MediaRecorder; option: VideoMimeOption } {
  for (const option of supportedMimeOptions()) {
    try {
      return { recorder: new MediaRecorder(stream, { mimeType: option.mimeType }), option };
    } catch {
      // Try the next explicitly supported MIME type before reporting a real failure.
    }
  }
  throw new Error('AudioFlip could not initialize a supported MP4 or WebM recorder in this browser.');
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Browser nodes may already be disconnected after a cancelled or completed export.
  }
}

function safeStop(source: AudioBufferSourceNode): void {
  try {
    source.stop();
  } catch {
    // One-shot sources can naturally end before cancellation reaches them.
  }
}

function drawVideoFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
  effectName: string,
  title: string,
  elapsed: number,
  duration: number,
): void {
  const { width, height } = canvas;
  const scale = width / 720;
  const colors = { charcoal: '#101014', violet: '#a78bfa', lime: '#c3ff36', text: '#f7f7fb', muted: '#a9a9b4' };
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#191722');
  background.addColorStop(0.52, colors.charcoal);
  background.addColorStop(1, '#111317');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.46, width * 0.52);
  glow.addColorStop(0, 'rgba(167,139,250,0.28)');
  glow.addColorStop(1, 'rgba(167,139,250,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.textAlign = 'center';
  context.fillStyle = colors.lime;
  context.font = `800 ${12 * scale}px system-ui, sans-serif`;
  context.letterSpacing = `${2 * scale}px`;
  context.fillText('AUDIOFLIP VISUAL', width / 2, 128 * scale);
  context.letterSpacing = '0px';

  if (title) {
    context.fillStyle = colors.text;
    context.font = `700 ${28 * scale}px system-ui, sans-serif`;
    context.fillText(title, width / 2, 210 * scale, width - 96 * scale);
  }

  context.fillStyle = colors.text;
  context.font = `900 ${64 * scale}px system-ui, sans-serif`;
  const effectParts = effectName.toUpperCase().split(' + ');
  effectParts.forEach((part, index) => {
    context.fillText(part, width / 2, (title ? 320 : 250) * scale + index * 76 * scale, width - 72 * scale);
  });

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const bars = 44;
  const gap = 6 * scale;
  const chartWidth = width - 88 * scale;
  const barWidth = (chartWidth - gap * (bars - 1)) / bars;
  const baseY = height * 0.66;
  const chartHeight = 360 * scale;
  for (let index = 0; index < bars; index += 1) {
    const value = data[Math.floor(index * data.length / bars)] / 255;
    const amplitude = Math.max(0.04, value) * chartHeight;
    const x = 44 * scale + index * (barWidth + gap);
    const y = baseY - amplitude / 2;
    const barGradient = context.createLinearGradient(0, y, 0, y + amplitude);
    barGradient.addColorStop(0, colors.lime);
    barGradient.addColorStop(1, colors.violet);
    context.fillStyle = barGradient;
    context.fillRect(x, y, barWidth, amplitude);
  }

  const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
  const trackX = 64 * scale;
  const trackWidth = width - 128 * scale;
  const trackY = height - 174 * scale;
  context.fillStyle = 'rgba(247,247,251,0.18)';
  context.fillRect(trackX, trackY, trackWidth, 4 * scale);
  context.fillStyle = colors.lime;
  context.fillRect(trackX, trackY, trackWidth * progress, 4 * scale);
  context.fillStyle = colors.muted;
  context.font = `700 ${15 * scale}px system-ui, sans-serif`;
  context.fillText('made with AudioFlip', width / 2, height - 100 * scale);
}

export function startVerticalVideoExport(options: VerticalVideoExportOptions): VideoExportJob {
  const support = getVideoExportSupport();
  if (!support.supported) throw new Error(support.reason);
  if (options.context.state !== 'running') throw new Error('Audio must be enabled before video export can start. Tap the button again.');
  if (!Number.isFinite(options.buffer.duration) || options.buffer.duration <= 0) throw new Error('The rendered audio has no usable duration for video export.');

  const canvas = document.createElement('canvas');
  const browserNavigator = navigator as Navigator & { deviceMemory?: number };
  const size = chooseVerticalCanvasSize({
    hardwareConcurrency: browserNavigator.hardwareConcurrency,
    deviceMemory: browserNavigator.deviceMemory,
  });
  canvas.width = size.width;
  canvas.height = size.height;
  const drawingContext = canvas.getContext('2d');
  if (!drawingContext) throw new Error('AudioFlip could not create a canvas for video export.');
  const captureStream = (canvas as CaptureCanvas).captureStream;
  if (typeof captureStream !== 'function') throw new Error('Canvas recording is not available in this browser.');

  const audioDuration = Math.min(options.buffer.duration, VIDEO_DURATION_CAP_SECONDS);
  // Some browser recorders omit a video stream when an animated canvas stops in only a few frames.
  // Keep a one-second visual hold for very short audio while leaving the audio itself unpadded.
  const duration = Math.max(audioDuration, MIN_VIDEO_DURATION_SECONDS);
  const canvasStream = captureStream.call(canvas, 30);
  const mediaDestination = options.context.createMediaStreamDestination();
  const analyser = options.context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.78;
  const source = options.context.createBufferSource();
  source.buffer = options.buffer;
  source.connect(analyser);
  analyser.connect(options.context.destination);
  analyser.connect(mediaDestination);
  const recordingStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...mediaDestination.stream.getAudioTracks(),
  ]);
  const { recorder, option } = createRecorder(recordingStream);

  let frameId: number | null = null;
  let stopTimer: number | null = null;
  let cancelled = false;
  let settled = false;
  let startedAt = 0;
  let requestStop: () => void = () => {};
  const chunks: BlobPart[] = [];

  const promise = new Promise<VideoExportArtifact>((resolve, reject) => {
    const cleanup = (): void => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (stopTimer !== null) window.clearTimeout(stopTimer);
      source.onended = null;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      safeDisconnect(source);
      safeDisconnect(analyser);
      safeDisconnect(mediaDestination);
      for (const track of recordingStream.getTracks()) track.stop();
      for (const track of canvasStream.getTracks()) track.stop();
      for (const track of mediaDestination.stream.getTracks()) track.stop();
    };

    const settle = (artifact?: VideoExportArtifact, failure?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      options.onProgress?.(failure ? 0 : 1);
      if (failure) reject(failure);
      else if (artifact) resolve(artifact);
    };

    const draw = (now: number): void => {
      const elapsed = Math.max(0, (now - startedAt) / 1000);
      drawVideoFrame(drawingContext, canvas, analyser, options.effectName, options.title, elapsed, duration);
      options.onProgress?.(Math.min(0.99, elapsed / duration));
      if (!settled && !cancelled) frameId = window.requestAnimationFrame(draw);
    };

    requestStop = (): void => {
      safeStop(source);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && !cancelled) chunks.push(event.data);
    };
    recorder.onerror = () => settle(undefined, new Error('Video recording stopped unexpectedly. Try a shorter clip or another browser.'));
    recorder.onstop = () => {
      if (cancelled) {
        settle(undefined, new Error('Video export cancelled.'));
        return;
      }
      const blob = new Blob(chunks, { type: option.mimeType });
      if (blob.size === 0) {
        settle(undefined, new Error('Video recording produced no data. Try another supported browser.'));
        return;
      }
      settle({ blob, mimeType: option.mimeType, extension: option.extension, duration, ...size });
    };
    try {
      recorder.start(250);
      startedAt = performance.now();
      drawVideoFrame(drawingContext, canvas, analyser, options.effectName, options.title, 0, duration);
      frameId = window.requestAnimationFrame(draw);
      source.start(0, 0, audioDuration);
      stopTimer = window.setTimeout(requestStop, Math.ceil(duration * 1000) + 120);
    } catch (reason) {
      settle(undefined, reason instanceof Error ? reason : new Error('Video recording could not start.'));
    }
  });

  return {
    promise,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      requestStop();
    },
  };
}
