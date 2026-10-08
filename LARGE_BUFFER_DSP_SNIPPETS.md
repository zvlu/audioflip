# AudioFlip large-buffer DSP snippets

> **Draft status:** These snippets are designed for the current AudioFlip source layout but are not compiled in this workspace. `rustc`, Cargo, wasm-bindgen, wasm-pack, and a WASM target are currently unavailable. Do not represent them as shipped Rust/WASM until the build and browser test steps at the end have passed.

The goal is to move **CPU-bound peak scanning and optional sample sanitation** off the UI thread for larger renders. Keep `decodeAudioData`, `OfflineAudioContext`, rate conversion, reverb, filters, playback, and Blob URL lifecycle in browser/TypeScript code.

## Design choice

| Path | Best use | Copy/memory behavior | Current recommendation |
| --- | --- | --- | --- |
| TypeScript main thread | Short renders / compatibility fallback | No extra channel copies | Keep for small buffers and unsupported browsers |
| TypeScript module worker | Long scans where UI responsiveness matters | Transfers copies of channel PCM; original `AudioBuffer` stays usable for preview | First performance experiment |
| Rust/WASM | Batch/custom DSP after profiling proves JavaScript scan/encode cost material | Copies each channel into WASM scratch memory once; Rust scans in WASM | Add only in a dedicated toolchain pass |

The current 60-second, stereo, 44.1 kHz limit is about **5.29 million f32 samples / 21.2 MB** of source PCM. A worker or WASM route must avoid retaining source, clone, encoded result, and historical renders indefinitely.

## 1. TypeScript worker fallback

### `src/audio/peak-worker.ts`

```ts
/// <reference lib="webworker" />

type PeakRequest = {
  kind: 'scan-peak';
  id: number;
  ceiling: number;
  /** Detached copies of channel data. Never transfer AudioBuffer channel backing stores. */
  channels: ArrayBuffer[];
};

type PeakResult = {
  kind: 'peak-result';
  id: number;
  peak: number;
  gain: number;
};

function scanPeak(channels: ArrayBuffer[]): number {
  let peak = 0;

  for (const channelBuffer of channels) {
    const samples = new Float32Array(channelBuffer);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (!Number.isFinite(sample)) continue;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }

  return peak;
}

self.onmessage = (event: MessageEvent<PeakRequest>) => {
  const { id, ceiling, channels } = event.data;
  if (event.data.kind !== 'scan-peak') return;

  const peak = scanPeak(channels);
  const gain = peak > ceiling && peak > 0 ? ceiling / peak : 1;
  const message: PeakResult = { kind: 'peak-result', id, peak, gain };
  self.postMessage(message);
};
```

### `src/audio/peak-service.ts`

```ts
import { OUTPUT_CEILING, peakGuardGain, peakOf } from './math';

type PeakResult = { peak: number; gain: number };

type PendingJob = {
  resolve: (value: PeakResult) => void;
  reject: (reason?: unknown) => void;
};

const WORKER_THRESHOLD_SAMPLES = 1_000_000;
let nextId = 1;
let worker: Worker | null = null;
const pending = new Map<number, PendingJob>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;

  try {
    worker = new Worker(new URL('./peak-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ kind: string; id: number; peak: number; gain: number }>) => {
      if (event.data.kind !== 'peak-result') return;
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      job.resolve({ peak: event.data.peak, gain: event.data.gain });
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Peak worker failed.');
      for (const job of pending.values()) job.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function copyChannelsForTransfer(buffer: AudioBuffer): ArrayBuffer[] {
  // .slice() makes a new backing store. Do not transfer getChannelData(...).buffer:
  // transferring it can detach the live AudioBuffer used for preview/export.
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel).slice().buffer,
  );
}

export async function measurePeakOffMainThread(buffer: AudioBuffer): Promise<PeakResult> {
  const samples = buffer.length * buffer.numberOfChannels;
  const currentWorker = samples >= WORKER_THRESHOLD_SAMPLES ? getWorker() : null;

  // Small buffers or worker startup failure use the exact existing TypeScript behavior.
  if (!currentWorker) {
    const peak = peakOf(buffer);
    return { peak, gain: peakGuardGain(peak, OUTPUT_CEILING) };
  }

  const id = nextId++;
  const channels = copyChannelsForTransfer(buffer);
  return new Promise<PeakResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    currentWorker.postMessage(
      { kind: 'scan-peak', id, ceiling: OUTPUT_CEILING, channels },
      channels,
    );
  });
}
```

### Integration in `src/audio/engine.ts`

Replace only the peak/gain calculation in `renderEffect`; keep the existing `OfflineAudioContext` graph and safe-buffer copy.

```ts
import { measurePeakOffMainThread } from './peak-service';

// Immediately after: const rendered = await offline.startRendering();
const { peak, gain: guardGain } = await measurePeakOffMainThread(rendered);
const safeBuffer = makeSafeBuffer(rendered, guardGain);
```

At the `App.tsx` call site, preserve the existing render work-version check **after every await**. A worker job cannot be reliably cancelled halfway through a scan, but its late result must never become the current preview/download after the user replaces a clip or begins another render.

```ts
const version = workVersionRef.current;
const result = await renderEffect(clip.buffer, trim, settings);
if (version !== workVersionRef.current) return; // discard stale worker/render result
```

### Important worker trade-off

The worker avoids a long UI-thread scan but requires one copied/transferable channel set. For a maximum stereo 60-second render, budget about 21 MB for that temporary copy, plus existing source/rendered buffers. Fall back to the main-thread implementation if allocation fails; never silently return unguarded output.

## 2. Rust/WASM peak scanning draft

This version uses one reusable WASM scratch buffer per channel. JavaScript copies the live `AudioBuffer` channel into WASM memory, invokes a native Rust loop, and reuses the same allocation for the next channel. That avoids keeping two channel copies in WASM simultaneously.

### `wasm-audio/Cargo.toml`

```toml
[package]
name = "audioflip-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
```

Pin the exact compatible Rust and `wasm-bindgen` versions only after the first reproducible build. Do not depend on an unpinned global toolchain in CI.

### `wasm-audio/src/lib.rs`

```rust
use wasm_bindgen::prelude::*;

const MAX_SAMPLES: usize = 16_000_000; // ~64 MiB f32 scratch hard ceiling

#[wasm_bindgen]
pub struct PeakBuffer {
    samples: Vec<f32>,
}

#[wasm_bindgen]
impl PeakBuffer {
    #[wasm_bindgen(constructor)]
    pub fn new(length: usize) -> Result<PeakBuffer, JsValue> {
        if length == 0 || length > MAX_SAMPLES {
            return Err(JsValue::from_str("Invalid WASM peak-buffer length."));
        }

        let mut samples = Vec::<f32>::new();
        samples
            .try_reserve_exact(length)
            .map_err(|_| JsValue::from_str("Unable to allocate WASM peak buffer."))?;
        samples.resize(length, 0.0);
        Ok(PeakBuffer { samples })
    }

    /// Byte offset is calculated by JavaScript as ptr() * Float32Array.BYTES_PER_ELEMENT.
    pub fn ptr(&mut self) -> *mut f32 {
        self.samples.as_mut_ptr()
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    /// Ignores NaN and Infinity. This matches AudioFlip's TypeScript peak semantics.
    pub fn scan_peak(&self) -> f32 {
        self.samples
            .iter()
            .filter(|sample| sample.is_finite())
            .fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
    }

    pub fn peak_guard_gain(&self, ceiling: f32) -> f32 {
        let peak = self.scan_peak();
        if !peak.is_finite() || peak <= 0.0 || peak <= ceiling {
            1.0
        } else {
            ceiling / peak
        }
    }

    /// Optional future step. Use only after parity tests prove the behavior matches TS.
    pub fn apply_gain_and_sanitize(&mut self, gain: f32) {
        for sample in self.samples.iter_mut() {
            let scaled = if sample.is_finite() { *sample * gain } else { 0.0 };
            *sample = scaled.clamp(-1.0, 1.0);
        }
    }
}
```

### `src/audio/wasm-dsp.ts`

The generated package API depends on the chosen binding tool, so isolate imports here. This draft assumes a generated `memory` export and a `PeakBuffer` class. Regenerate names from the actual package rather than hand-editing generated bindings.

```ts
import { OUTPUT_CEILING, peakGuardGain, peakOf } from './math';

type WasmModule = {
  memory: WebAssembly.Memory;
  PeakBuffer: new (length: number) => {
    ptr(): number;
    len(): number;
    scan_peak(): number;
    peak_guard_gain(ceiling: number): number;
    free(): void;
  };
};

let wasmPromise: Promise<WasmModule> | null = null;

async function loadWasm(): Promise<WasmModule> {
  // Match this import path to the output of `wasm-pack build --target web`.
  wasmPromise ??= import('../../wasm-audio/pkg/audioflip_wasm.js') as Promise<WasmModule>;
  return wasmPromise;
}

export async function measurePeakWithWasm(buffer: AudioBuffer): Promise<{ peak: number; gain: number }> {
  const wasm = await loadWasm();
  const scratch = new wasm.PeakBuffer(buffer.length);
  let peak = 0;

  try {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      // Recreate this view after any WASM allocation; memory.grow() can invalidate older views.
      const wasmView = new Float32Array(
        wasm.memory.buffer,
        scratch.ptr(),
        scratch.len(),
      );
      wasmView.set(buffer.getChannelData(channel)); // one explicit JS -> WASM copy
      peak = Math.max(peak, scratch.scan_peak());
    }
  } finally {
    scratch.free();
  }

  return { peak, gain: peakGuardGain(peak, OUTPUT_CEILING) };
}

export async function measurePeakWithFallback(buffer: AudioBuffer): Promise<{ peak: number; gain: number }> {
  try {
    return await measurePeakWithWasm(buffer);
  } catch {
    // WASM failure must retain safety behavior, not bypass peak guarding.
    const peak = peakOf(buffer);
    return { peak, gain: peakGuardGain(peak, OUTPUT_CEILING) };
  }
}
```

### Why this does not promise a universal speedup

There is still one deliberate JavaScript-to-WASM copy per channel. The Rust loop can outperform a large JavaScript loop or be worthwhile when extended with custom DSP, but browser-native `OfflineAudioContext` remains the dominant effect-render engine. Measure the worker and WASM approaches against the existing TypeScript loop before keeping either path.

## 3. Safe build and rollout sequence

1. In a dedicated toolchain pass, install a pinned Rust toolchain plus `wasm32-unknown-unknown`, wasm-bindgen, and wasm-pack.
2. Add `pnpm build:wasm` and make `pnpm build` depend on it. Do not hand-commit generated bindings without a reproducible generator command.
3. Add deterministic Rust tests for silence, NaN, Infinity, ±1, values over ceiling, and channel-length bounds.
4. Add TypeScript parity tests: Rust/WASM and TypeScript must produce the same peak/gain within a documented float tolerance.
5. Render the real AudioFlip demo through Original, Slowed + reverb, Sped up, Nightcore-style, and Bass boost using the new path and fallback path. Decode each WAV and verify header, duration, channel count, and bounded samples.
6. Test source replacement while a worker/WASM job is in flight. The existing work-version guard must discard the old render; never attach it to the replacement source.
7. Profile memory and UI responsiveness at 10 s, 30 s, and 60 s stereo. Keep the new path only if it produces a measurable benefit without destabilizing preview/export correctness.

## 4. What not to do

- Do not transfer the backing `ArrayBuffer` returned by `AudioBuffer.getChannelData()` directly: it can detach a live preview/export buffer.
- Do not claim that WASM accelerates browser decode, convolver, filters, or offline render graph scheduling.
- Do not retain every render or cache raw user audio in localStorage, IndexedDB, analytics, or a server merely to support performance work.
- Do not enable Rust/WASM as a hidden mandatory dependency without a TypeScript fallback and failure state.
- Do not enlarge the current 20 MB/60-second product limits until profiling, memory handling, mobile testing, and UX disclosure support the change.
