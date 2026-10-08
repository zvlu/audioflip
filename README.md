# AudioFlip MVP

AudioFlip is a **mobile-first, browser-only** audio editor for making slowed + reverb, sped-up, nightcore-style, and bass-boosted versions of a single local clip. The project is a private local-preview MVP: it has **no account system, backend audio storage, analytics, checkout, email capture, payment integration, or public deployment**.

> Working name only; not trademark-cleared.

## Run locally

Requirements: Node 22+ and pnpm 11+.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the development URL printed by Vite. For a production build and deterministic checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## How audio works

1. Select **Try the demo** for a short original local tone/percussion clip, or choose/drop a file.
2. Set trim points, choose Original or one of four effects, and adjust the shown controls.
3. Select **Render WAV**. The app performs the full render in an `OfflineAudioContext`, shows the exact rendered result, then offers **Play processed** and **Download WAV**.

The app never uploads source audio. It decodes the current source in memory, keeps only the active source and latest render, revokes the previous rendered Blob URL, and does not use localStorage for audio, identity, or analytics.

### Effect semantics

| Effect | Controls | Honest behavior |
| --- | --- | --- |
| Original | Trim | Re-encodes the selected source range as WAV for comparison. |
| Slowed + reverb | 0.65–1.00×; 0–40% wet | Playback-rate slowdown and generated short reverb. |
| Sped up | 1.00–1.50× | Dry faster playback. |
| Nightcore-style | 1.10–1.60×; optional brightness | Coupled faster playback and higher pitch, not independent pitch shifting. |
| Bass boost | 0–12 dB low shelf at 120 Hz | Low-end lift protected by a simple peak guard. |

Any playback-rate effect changes **pitch and duration together**. There is no independent pitch shifting or time stretching. Peak guarding makes samples safe for 16-bit PCM encoding; it is not professional mastering, LUFS normalization, or a promise of distortion-free bass on every playback system.

## Limits and support

- **Input limit:** 20 MiB and 60 seconds after decoding. The size cap is checked by both the UI and decoder before decoding; a small compressed input can still expand in browser memory before its decoded duration is rejected.
- **Formats:** WAV and MP3 are first-class choices. Other selected audio is accepted only if the active browser can decode it; extension alone is not trusted.
- **Output:** genuine RIFF/WAVE with PCM 16-bit interleaved data. The offline renderer targets 44.1 kHz and falls back to the decoded source sample rate only if 44.1 kHz context creation fails and the bounded fallback allocation is safe. Mono input remains mono; non-mono input is rendered to stereo through the browser's Web Audio channel mixing.
- **Browser requirements:** full functionality needs `AudioContext`, `OfflineAudioContext`, `decodeAudioData`, `AudioBuffer`, Blob download, and a user interaction that permits audio playback. Current desktop Chromium-like browsers are the primary preview target. Mobile Safari and audible device playback are not claimed as verified unless specifically recorded in the delivery note.
- **Rights:** Only use audio you own or have permission to edit and publish. Effects do not remove copyright restrictions. Import the exported audio into a video editor and follow that platform’s format and music-rights rules. AudioFlip is not a direct TikTok uploader or ready-made TikTok video generator.

## Test coverage

`tests/audio.test.ts` checks trim validation, rate-to-duration math, finite peak measurement/guard gain, validated effect ranges, input/OfflineAudioContext allocation boundaries, 16-bit WAV RIFF/header/data length, mono safety, interleaving, signed quantization, and decoder size enforcement. `tests/creator-modal.test.tsx` covers dialog focus entry, Tab/Shift+Tab looping, Escape, background inerting, and restored trigger focus. `tests/app-lifecycle.test.tsx` covers reset source retention, rendered URL revocation on reset/clear, and a late decode ignored after Clear.

The interface also exposes invalid/oversize/decode failure states and defensively handles silence, NaN samples, short clips, repeated rendering, invalid trim values, mono sources, and new uploads. The demo is original code-generated audio, and all four visual presets use different Web Audio graph settings.

### Validation snapshot (2026-10-08, Phase 2 core hardening)

- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed. The current Vitest run has **12/12** passing tests across three files.
- A private Chromium pass rendered the original demo through Original, Slowed + reverb, Sped up, Nightcore-style, and Bass boost. Observed durations were 10.0 s, 13.7 s, 8.0 s, 7.4 s, and 10.0 s respectively. Processed playback started and stopped through the visible control.
- Clearing immediately after a slowed render began left **No source loaded**, no rendered download, neutral effect selection, and a recoverable empty state. Reset retained the loaded source and returned to Original. A live dialog check confirmed focus entry, Tab looping, Escape close, background inerting, and trigger focus restoration.
- Actual input-change events rejected empty, corrupt, oversize, and 61-second WAV fixtures; a valid WAV labeled `.mp3` decoded by content rather than extension; and a 96 kHz mono fixture rendered to 44.1 kHz PCM16 mono. The downloaded `audioflip-original.wav` independently decoded as 1 channel, 44,100 Hz, 16-bit PCM, 2,205 frames / 0.0500 seconds, with integer peak 8,192.
- Full-page desktop, 375 px, and 320 px layouts plus the live dialog were inspected. The browser reported no audio-named network resource entries and empty local/session storage after local operations; this is a smoke observation, not a substitute for a production network/privacy audit.
- **Unverified:** subjective audible listening, Firefox/WebKit-specific checks, and physical current iOS Safari/Android Chrome playback. No compatibility or sound-quality claim is made for those surfaces.

## Rust/WASM status

**Rust/WASM is not used in this version.** A fresh active-Sandbox gate on 2026-10-08 found `rustc`, Cargo, rustup, installed WASM targets, `wasm-pack`, `wasm-bindgen`, and `wasm-opt` all missing. No installation was attempted: this pass has no ready Rust build path or technically enforceable per-run budget cap. There is no Rust crate, generated WASM asset, worker, or runtime WASM path. TypeScript owns trim/rate validation, finite peak measurement, shared-channel gain, sample sanitation, and PCM encoding. The exact gate record is in [RUST_WASM_GATE_RECORD.md](RUST_WASM_GATE_RECORD.md). A later Rust DSP module can replace bounded post-render PCM work only after it is compiled to WASM, imported into `src/audio/engine.ts`, and exercised in a real browser render. Reverb, filters, rate conversion, preview, decode, and render graph should remain browser Web Audio responsibilities.

## Deferred features and proposed billing

Not implemented: MP3/AAC export, ZIP/batch export, vertical MP4/visualizer output, reusable presets, accounts, any enforcement of paid features, and payments. Vertical video export is a future feature, not a button.

The proposed **Creator** plan is clearly pre-launch only: $4.99/month for a future preset library, batch processing, and vertical video export. A real billing version should use server-created checkout sessions, verified payment webhooks, authenticated entitlements, server-only secret keys, cancellation/account management, and clear recurring-price disclosure. Browser-only quotas or feature locks are not secure payment enforcement.

## Next build priorities

1. **Native browser/device compatibility validation:** test the exact audio graph on current iOS Safari and Android Chrome, then document concrete support findings.
2. **Creator-grade editing value:** reusable local presets and clearly bounded batch processing, keeping privacy behavior transparent.
3. **Visual output:** a real vertical video/visualizer export pipeline, after determining its asset/right/compute constraints.
4. **Commercial and rights validation:** legal/trademark review and creator rights guidance, independently from core editing.
5. **Payments only after authorization:** introduce the secure server-backed billing architecture above after credentials and explicit payment approval exist.
