import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import { createDemoBuffer } from './audio/demo';
import {
  activeRate,
  decodeLocalFile,
  effectLabel,
  enableAudio,
  getAudioContext,
  playRenderedBuffer,
  playSourceRange,
  renderEffect,
  type PlaybackHandle,
} from './audio/engine';
import { clamp, formatTime, validateTrim } from './audio/math';
import { NEUTRAL_SETTINGS, settingsForEffect } from './audio/presets';
import { encodePcm16Wav } from './audio/wav';
import { MAX_DURATION_SECONDS, MAX_FILE_BYTES } from './audio/types';
import type { EffectId, EffectSettings, TrimRange } from './audio/types';

type Clip = {
  buffer: AudioBuffer;
  name: string;
  origin: 'demo' | 'local';
};

type Rendered = {
  buffer: AudioBuffer;
  url: string;
  filename: string;
  peak: number;
  guardGain: number;
};

type PlaybackKind = 'original' | 'processed' | null;

const effectCards: Array<{ id: EffectId; name: string; eyebrow: string; detail: string }> = [
  { id: 'original', name: 'Original', eyebrow: 'COMPARE', detail: 'Trimmed, unchanged source.' },
  { id: 'slowed', name: 'Slowed + reverb', eyebrow: '0.80× + SPACE', detail: 'Lower, longer, lightly washed.' },
  { id: 'sped', name: 'Sped up', eyebrow: '1.25×', detail: 'Fast, dry, direct.' },
  { id: 'nightcore', name: 'Nightcore-style', eyebrow: '1.35× + BRIGHT', detail: 'Coupled faster pitch and sparkle.' },
  { id: 'bass', name: 'Bass boost', eyebrow: '+6 dB @ 120 Hz', detail: 'Low-end lift with headroom guard.' },
];

function fileMegabytes(): string {
  return `${MAX_FILE_BYTES / 1024 / 1024} MB`;
}

export default function App() {
  const contextRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const renderedUrlRef = useRef<string | null>(null);
  const workVersionRef = useRef(0);

  const [clip, setClip] = useState<Clip | null>(null);
  const [trim, setTrim] = useState<TrimRange>({ start: 0, end: 0 });
  const [settings, setSettings] = useState<EffectSettings>(NEUTRAL_SETTINGS);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('Choose the demo or an audio file to begin.');
  const [dragging, setDragging] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [playing, setPlaying] = useState<PlaybackKind>(null);
  const [playProgress, setPlayProgress] = useState(0);
  const [creatorOpen, setCreatorOpen] = useState(false);

  useEffect(() => {
    return () => {
      stopPlayback();
      if (renderedUrlRef.current) URL.revokeObjectURL(renderedUrlRef.current);
      void contextRef.current?.close();
    };
  }, []);

  function getContext(): AudioContext {
    if (!contextRef.current) contextRef.current = getAudioContext();
    return contextRef.current;
  }

  async function activateAudio(): Promise<AudioContext> {
    const context = getContext();
    await enableAudio(context);
    setAudioEnabled(true);
    return context;
  }

  function clearTimer(): void {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function stopPlayback(): void {
    clearTimer();
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(null);
    setPlayProgress(0);
  }

  function finishPlayback(): void {
    clearTimer();
    playbackRef.current = null;
    setPlaying(null);
    setPlayProgress(0);
  }

  function startProgress(kind: Exclude<PlaybackKind, null>, duration: number): void {
    const started = performance.now();
    setPlaying(kind);
    setPlayProgress(0);
    progressTimerRef.current = window.setInterval(() => {
      setPlayProgress(Math.min(1, (performance.now() - started) / (duration * 1000)));
    }, 40);
  }

  function discardRender(): void {
    if (renderedUrlRef.current) URL.revokeObjectURL(renderedUrlRef.current);
    renderedUrlRef.current = null;
    setRendered(null);
  }

  function startSourceWork(): number {
    workVersionRef.current += 1;
    stopPlayback();
    setIsRendering(false);
    return workVersionRef.current;
  }

  function applyLoadedClip(nextClip: Clip): void {
    stopPlayback();
    discardRender();
    setClip(nextClip);
    setTrim({ start: 0, end: nextClip.buffer.duration });
    setSettings(NEUTRAL_SETTINGS);
    setError(null);
    setNotice(`${nextClip.name} is ready. Pick a flip, trim it, then render.`);
  }

  async function useDemo(): Promise<void> {
    const version = startSourceWork();
    setIsLoading(true);
    setError(null);
    try {
      const context = getContext();
      if (context.state === 'running') setAudioEnabled(true);
      const buffer = createDemoBuffer(context);
      if (version !== workVersionRef.current) return;
      applyLoadedClip({ buffer, name: 'AudioFlip original demo', origin: 'demo' });
    } catch {
      if (version === workVersionRef.current) {
        setError('Audio could not be enabled. Tap again and allow sound for this page.');
      }
    } finally {
      if (version === workVersionRef.current) setIsLoading(false);
    }
  }

  async function selectFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`“${file.name}” is too large. AudioFlip accepts clips up to ${fileMegabytes()}.`);
      return;
    }

    const version = startSourceWork();
    setIsLoading(true);
    setError(null);
    try {
      const context = await activateAudio();
      const buffer = await decodeLocalFile(file, context);
      if (version !== workVersionRef.current) return;
      if (buffer.duration > MAX_DURATION_SECONDS) {
        throw new Error(`This clip is ${formatTime(buffer.duration)} long. Keep source clips to ${MAX_DURATION_SECONDS} seconds or less.`);
      }
      applyLoadedClip({ buffer, name: file.name, origin: 'local' });
    } catch (reason) {
      if (version === workVersionRef.current) {
        setError(reason instanceof Error ? reason.message : 'This file could not be loaded.');
      }
    } finally {
      if (version === workVersionRef.current) setIsLoading(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    void selectFile(event.target.files?.[0]);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (isLoading || isRendering) {
      setNotice('Wait for the current local audio work to finish before replacing the source.');
      return;
    }
    void selectFile(event.dataTransfer.files?.[0]);
  }

  function chooseEffect(effect: EffectId): void {
    stopPlayback();
    discardRender();
    setSettings(settingsForEffect(effect));
    setNotice(`${effectCards.find((card) => card.id === effect)?.name ?? 'Effect'} selected. Render to hear the exact export.`);
  }

  function updateSetting(patch: Partial<EffectSettings>): void {
    stopPlayback();
    discardRender();
    setSettings((previous) => ({ ...previous, ...patch }));
    setNotice('Settings changed. Render again for an updated processed preview and download.');
  }

  function updateTrim(part: keyof TrimRange, rawValue: number): void {
    if (!clip) return;
    stopPlayback();
    discardRender();
    setTrim((current) => {
      const smallestGap = Math.min(0.01, clip.buffer.duration / 100);
      if (part === 'start') {
        return { ...current, start: clamp(rawValue, 0, Math.max(0, current.end - smallestGap)) };
      }
      return { ...current, end: clamp(rawValue, Math.min(clip.buffer.duration, current.start + smallestGap), clip.buffer.duration) };
    });
  }

  function resetEditor(): void {
    if (!clip) return;
    stopPlayback();
    discardRender();
    setTrim({ start: 0, end: clip.buffer.duration });
    setSettings(NEUTRAL_SETTINGS);
    setError(null);
    setNotice('Neutral settings restored. Your source is still loaded.');
  }

  async function playOriginal(): Promise<void> {
    if (!clip) return;
    if (playing === 'original') {
      stopPlayback();
      return;
    }
    setError(null);
    try {
      stopPlayback();
      const context = await activateAudio();
      playbackRef.current = playSourceRange(context, clip.buffer, trim, finishPlayback);
      startProgress('original', trim.end - trim.start);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Original preview could not start.');
    }
  }

  async function render(): Promise<void> {
    if (!clip) return;
    const trimError = validateTrim(trim, clip.buffer.duration);
    if (trimError) {
      setError(trimError);
      return;
    }
    stopPlayback();
    workVersionRef.current += 1;
    const version = workVersionRef.current;
    setIsRendering(true);
    setError(null);
    setNotice('Rendering locally on this device…');
    try {
      const result = await renderEffect(clip.buffer, trim, settings);
      if (version !== workVersionRef.current) return;
      const blob = encodePcm16Wav(result.buffer);
      const url = URL.createObjectURL(blob);
      discardRender();
      renderedUrlRef.current = url;
      const nextRendered: Rendered = {
        buffer: result.buffer,
        url,
        filename: `audioflip-${effectLabel(settings.effect)}.wav`,
        peak: result.peak,
        guardGain: result.guardGain,
      };
      setRendered(nextRendered);
      const guardNote = result.guardGain < 1 ? ' Peak guard reduced output safely.' : ' Peak guard found safe headroom.';
      setNotice(`Rendered ${formatTime(result.duration)} of 16-bit PCM WAV at ${(result.buffer.sampleRate / 1000).toFixed(1)} kHz.${guardNote}`);
    } catch (reason) {
      if (version === workVersionRef.current) {
        setError(reason instanceof Error ? reason.message : 'Rendering failed. Try a shorter clip or another browser-supported format.');
        setNotice('No download was created. Your original source is unchanged.');
      }
    } finally {
      if (version === workVersionRef.current) setIsRendering(false);
    }
  }

  async function playProcessed(): Promise<void> {
    if (!rendered) return;
    if (playing === 'processed') {
      stopPlayback();
      return;
    }
    setError(null);
    try {
      stopPlayback();
      const context = await activateAudio();
      playbackRef.current = playRenderedBuffer(context, rendered.buffer, finishPlayback);
      startProgress('processed', rendered.buffer.duration);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Processed preview could not start.');
    }
  }

  function download(): void {
    if (!rendered) return;
    const link = document.createElement('a');
    link.href = rendered.url;
    link.download = rendered.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setNotice(`${rendered.filename} download started. Import the audio into your video editor, then follow that platform’s music and format rules.`);
  }

  const selectedCard = effectCards.find((card) => card.id === settings.effect);
  const trimLength = Math.max(0, trim.end - trim.start);
  const estimatedDuration = settings.effect === 'slowed' && settings.reverbMix > 0
    ? trimLength / activeRate(settings) + 1.2
    : trimLength / activeRate(settings);

  return (
    <main>
      <section className="hero shell" aria-labelledby="page-title">
        <div className="brand-row">
          <a className="wordmark" href="#top" aria-label="AudioFlip home">
            <span className="mark" aria-hidden="true"><i /><i /><i /></span>
            AUDIO<span>FLIP</span>
          </a>
          <span className="local-pill">LOCAL ONLY</span>
        </div>
        <div className="hero-copy" id="top">
          <p className="eyebrow">MUSIC, FLIPPED YOUR WAY</p>
          <h1 id="page-title">Flip your sound<br /><em>in a few taps.</em></h1>
          <p className="lede">Turn your own clip into a slowed, sped-up, nightcore-style, or bass-boosted version—right in your browser.</p>
        </div>
        <div className="hero-actions">
          <button className="button primary" onClick={() => void useDemo()} disabled={isLoading || isRendering}>
            <span aria-hidden="true">▶</span> Try the demo
          </button>
          <label className="button secondary file-button">
            <span aria-hidden="true">＋</span> Choose audio
            <input type="file" accept="audio/wav,audio/mpeg,audio/*" onChange={onFileChange} disabled={isLoading || isRendering} />
          </label>
        </div>
        <p className="limits">WAV and MP3 first · up to {fileMegabytes()} · up to {MAX_DURATION_SECONDS} seconds · processed on this device</p>
      </section>

      <section className="shell editor-section" aria-labelledby="editor-title">
        <div className="section-heading">
          <p className="eyebrow">01 / SOUND LAB</p>
          <h2 id="editor-title">Make a clean flip.</h2>
          <p>Rates change pitch and duration together. There is no independent pitch shift or time stretching.</p>
        </div>

        <div
          className={`drop-zone ${dragging ? 'dragging' : ''} ${isLoading || isRendering ? 'busy' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(!(isLoading || isRendering)); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-disabled={isLoading || isRendering}
        >
          <div className="source-meta">
            <span className="source-icon" aria-hidden="true">♫</span>
            <div>
              <strong>{clip?.name ?? 'No source loaded'}</strong>
              <span>{clip ? `${clip.origin === 'demo' ? 'Original demo' : 'Local file'} · ${formatTime(clip.buffer.duration)}` : 'Drop a file here on desktop, or choose audio above.'}</span>
            </div>
          </div>
          {clip && <span className="ready-chip">READY</span>}
        </div>

        {!audioEnabled && <div className="audio-hint">Tap a preview or demo button to enable audio in your browser.</div>}
        {error && <div className="message error" role="alert">{error}</div>}
        <div className="message status" aria-live="polite">{isLoading ? 'Decoding your file locally…' : isRendering ? 'Processing your selected effect locally…' : notice}</div>

        <div className={`editor-card ${clip ? '' : 'muted'}`}>
          <div className="card-topline">
            <div>
              <p className="eyebrow">02 / TRIM SOURCE</p>
              <h3>Keep the good part.</h3>
            </div>
            <button className="text-button" disabled={!clip || isLoading || isRendering} onClick={resetEditor}>Reset neutral</button>
          </div>

          <div className="preview-strip" aria-label="Trimmed original preview">
            <div className="playback-wave" aria-hidden="true">
              {Array.from({ length: 34 }, (_, index) => <span key={index} style={{ height: `${20 + ((index * 19) % 62)}%` }} />)}
              <b style={{ transform: `scaleX(${playing === 'original' ? playProgress : 0})` }} />
            </div>
            <button className="play-button" disabled={!clip || isLoading || isRendering} onClick={() => void playOriginal()}>
              {playing === 'original' ? 'Stop original' : 'Play original'}
            </button>
          </div>

          <div className="trim-controls">
            <label>
              <span>Start <b>{formatTime(trim.start)}</b></span>
              <input aria-label="Trim start" type="range" min="0" max={clip?.buffer.duration ?? 1} step="0.01" value={trim.start} disabled={!clip || isLoading || isRendering} onChange={(event) => updateTrim('start', Number(event.target.value))} />
            </label>
            <label>
              <span>End <b>{formatTime(trim.end)}</b></span>
              <input aria-label="Trim end" type="range" min="0" max={clip?.buffer.duration ?? 1} step="0.01" value={trim.end} disabled={!clip || isLoading || isRendering} onChange={(event) => updateTrim('end', Number(event.target.value))} />
            </label>
            <div className="trim-readout"><span>Selected</span><strong>{formatTime(trimLength)}</strong></div>
          </div>
        </div>

        <div className={`effects-area ${clip ? '' : 'muted'}`}>
          <div className="card-topline effects-title">
            <div>
              <p className="eyebrow">03 / PICK A FLIP</p>
              <h3>Choose your version.</h3>
            </div>
            <span className="effect-count">{selectedCard?.name}</span>
          </div>
          <div className="effect-list" role="list" aria-label="Audio effects">
            {effectCards.map((card) => (
              <button
                key={card.id}
                className={`effect-card ${settings.effect === card.id ? 'selected' : ''}`}
                onClick={() => chooseEffect(card.id)}
                disabled={!clip || isLoading || isRendering}
                aria-pressed={settings.effect === card.id}
              >
                <span className="effect-index">{card.eyebrow}</span>
                <strong>{card.name}</strong>
                <small>{card.detail}</small>
                <span className="select-dot" aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="control-panel">
            {settings.effect === 'original' && <p className="control-copy">Original exports the trimmed source as a newly encoded PCM WAV for a fair comparison.</p>}
            {(settings.effect === 'slowed' || settings.effect === 'sped' || settings.effect === 'nightcore') && (
              <label className="range-label">
                <span>{settings.effect === 'slowed' ? 'Playback speed' : 'Playback speed'} <b>{settings.rate.toFixed(2)}×</b></span>
                <input type="range" min={settings.effect === 'slowed' ? '0.65' : settings.effect === 'sped' ? '1' : '1.1'} max={settings.effect === 'slowed' ? '1' : settings.effect === 'sped' ? '1.5' : '1.6'} step="0.01" value={settings.rate} onChange={(event) => updateSetting({ rate: Number(event.target.value) })} disabled={!clip || isLoading || isRendering} />
              </label>
            )}
            {settings.effect === 'slowed' && (
              <label className="range-label">
                <span>Reverb wet mix <b>{Math.round(settings.reverbMix * 100)}%</b></span>
                <input type="range" min="0" max="0.4" step="0.01" value={settings.reverbMix} onChange={(event) => updateSetting({ reverbMix: Number(event.target.value) })} disabled={!clip || isLoading || isRendering} />
              </label>
            )}
            {settings.effect === 'nightcore' && (
              <label className="check-label"><input type="checkbox" checked={settings.brightness} onChange={(event) => updateSetting({ brightness: event.target.checked })} disabled={!clip || isLoading || isRendering} /> Modest brightness filter <span>Optional sparkle</span></label>
            )}
            {settings.effect === 'bass' && (
              <label className="range-label">
                <span>Bass at 120 Hz <b>+{settings.bassGain.toFixed(0)} dB</b></span>
                <input type="range" min="0" max="12" step="1" value={settings.bassGain} onChange={(event) => updateSetting({ bassGain: Number(event.target.value) })} disabled={!clip || isLoading || isRendering} />
              </label>
            )}
            {settings.effect === 'bass' && <p className="control-copy">A headroom guard protects the exported encoding. Heavy bass can still change how speakers feel—it is not distortion-free mastering.</p>}
            <div className="output-estimate"><span>Estimated export</span><strong>{formatTime(estimatedDuration)}</strong></div>
          </div>
        </div>

        <div className={`render-card ${clip ? '' : 'muted'}`}>
          <div>
            <p className="eyebrow">04 / RENDER &amp; KEEP</p>
            <h3>Hear the exact WAV first.</h3>
            <p>Same trim and effect settings for processed preview and download. Peak guard is safety, not mastering.</p>
          </div>
          <button className="button primary render-button" disabled={!clip || isLoading || isRendering} onClick={() => void render()}>
            {isRendering ? 'Rendering locally…' : 'Render WAV'}
          </button>
        </div>

        {rendered && (
          <div className="result-card">
            <div className="result-copy">
              <span className="ready-chip">RENDERED</span>
              <h3>{rendered.filename}</h3>
              <p>{formatTime(rendered.buffer.duration)} · {(rendered.buffer.sampleRate / 1000).toFixed(1)} kHz · PCM 16-bit WAV · {rendered.buffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</p>
              {rendered.guardGain < 1 && <small>Output reduced by {Math.round((1 - rendered.guardGain) * 100)}% to prevent PCM clipping.</small>}
            </div>
            <div className="result-actions">
              <button className="button secondary" onClick={() => void playProcessed()}>{playing === 'processed' ? 'Stop processed' : 'Play processed'}</button>
              <button className="button lime" onClick={download}>Download WAV ↓</button>
            </div>
          </div>
        )}
      </section>

      <section className="shell guide-section" aria-labelledby="guide-title">
        <div className="section-heading">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2 id="guide-title">From sound to screen capture.</h2>
        </div>
        <div className="steps">
          <article><span>01</span><h3>Load your clip</h3><p>Use the original demo or an audio file you have rights to edit.</p></article>
          <article><span>02</span><h3>Set the flip</h3><p>Trim first, pick a mode, and adjust only the controls that matter.</p></article>
          <article><span>03</span><h3>Bring it to video</h3><p>Download WAV, then import it into your preferred video editor.</p></article>
        </div>
        <div className="two-up">
          <aside className="info-card"><p className="eyebrow">GOOD FOR</p><h3>Before/after edits, mood changes, speed ramps, and low-end experiments.</h3><p>AudioFlip is a one-file editor—not a TikTok uploader or a finished vertical video maker.</p></aside>
          <aside className="info-card rights"><p className="eyebrow">RIGHTS + PRIVACY</p><h3>Made on this device. Nothing uploaded.</h3><p>Only use audio you own or have permission to edit and publish. Effects do not remove copyright restrictions.</p><p>After download, follow the video platform’s format and music-rights rules.</p></aside>
        </div>
      </section>

      <section className="shell pricing-section" aria-labelledby="pricing-title">
        <div className="section-heading"><p className="eyebrow">PRE-LAUNCH PRICING</p><h2 id="pricing-title">Useful now. More later.</h2></div>
        <div className="pricing-grid">
          <article className="plan-card"><span className="plan-tag">LIVE TODAY</span><h3>Free</h3><p className="price">$0 <small>/ month</small></p><p>Current single-clip editor, local processing, and WAV download.</p><span className="included">Included in this MVP</span></article>
          <article className="plan-card creator"><span className="plan-tag">PROPOSED · PRE-LAUNCH</span><h3>Creator</h3><p className="price">$4.99 <small>/ month</small></p><p>Future reusable preset library, batch processing, and vertical video export.</p><button className="text-button violet" onClick={() => setCreatorOpen(true)}>Creator plan coming soon →</button></article>
        </div>
        <p className="future-note">Vertical video export is a future feature—not a working button in this version.</p>
      </section>

      <footer className="shell"><span className="wordmark small"><span className="mark" aria-hidden="true"><i /><i /><i /></span>AUDIO<span>FLIP</span></span><p>Local-first audio transformations for your own clips.</p></footer>

      {creatorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCreatorOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="creator-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" aria-label="Close" onClick={() => setCreatorOpen(false)}>×</button>
            <p className="eyebrow">CREATOR · PROPOSED</p>
            <h2 id="creator-modal-title">Coming soon—not for sale today.</h2>
            <p>Creator is a future $4.99/month idea for reusable presets, batch processing, and vertical video export. There is no checkout, account, card collection, or paywall in this MVP.</p>
            <p className="modal-note">A future billing build would use server-created checkout sessions, verified payment webhooks, authenticated entitlements, server-only secrets, cancellation/account management, and clear recurring-price disclosure. Browser-only paid locks are not secure enforcement.</p>
            <button className="button primary" onClick={() => setCreatorOpen(false)}>Got it</button>
          </section>
        </div>
      )}
    </main>
  );
}
