# AudioFlip MVP

AudioFlip is a **mobile-first, browser-only** audio editor for making slowed + reverb, sped-up, nightcore-style, and bass-boosted versions of a single local clip. The project is a private local-preview MVP: it has **no account system, backend audio storage, analytics, checkout, email capture, payment integration, or public deployment**.

> Working name only; not trademark-cleared.

## Run locally

Requirements: Node 22+ and pnpm 11+.

```bash
pnpm install
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

- **Input limit:** 20 MB and 60 seconds after decoding.
- **Formats:** WAV and MP3 are first-class choices. Other selected audio is accepted only if the active browser can decode it; extension alone is not trusted.
- **Output:** genuine RIFF/WAVE with PCM 16-bit interleaved data. The offline renderer targets 44.1 kHz and falls back to the decoded source sample rate only if 44.1 kHz context creation fails. Mono input remains mono; multi-channel sources are sensibly rendered to stereo.
- **Browser requirements:** full functionality needs `AudioContext`, `OfflineAudioContext`, `decodeAudioData`, `AudioBuffer`, Blob download, and a user interaction that permits audio playback. Current desktop Chromium-like browsers are the primary preview target. Mobile Safari and audible device playback are not claimed as verified unless specifically recorded in the delivery note.
- **Rights:** Only use audio you own or have permission to edit and publish. Effects do not remove copyright restrictions. Import the exported audio into a video editor and follow that platform’s format and music-rights rules. AudioFlip is not a direct TikTok uploader or ready-made TikTok video generator.

## Test coverage

`tests/audio.test.ts` checks trim validation, rate-to-duration math, finite peak measurement/guard gain, 16-bit WAV RIFF/header/data length, mono safety, and stereo interleaving. Use `pnpm test` for the current recorded result; delivery notes include the actual command output for this workspace.

The interface also exposes invalid/oversize/decode failure states and defensively handles silence, NaN samples, short clips, repeated rendering, invalid trim values, mono sources, and new uploads. The demo is original code-generated audio, and all four visual presets use different Web Audio graph settings.

### Validation snapshot (2026-10-08)

- `pnpm typecheck`, `pnpm test`, and `pnpm build` passed; the test run has **6/6** passing assertions.
- A private Chromium browser pass loaded the original demo; rendered Original, Slowed + reverb, Sped up, Nightcore-style, and Bass boost; and observed the expected distinct output filenames and rate-adjusted durations (10.0 s original, 13.7 s slowed/reverb, 8.0 s sped, 7.4 s nightcore, and 10.0 s bass).
- The visible processed-playback control was exercised. The browser generated and downloaded `audioflip-sped-up.wav`; Python’s WAV decoder confirmed stereo, 44,100 Hz, 16-bit PCM, 352,800 frames / 8.0 seconds, and a bounded 32,112-sample peak.
- Browser checks also covered unsupported decode feedback, early 20 MB rejection, short mono silence rendering, repeated rendering, preset-default restoration, and a drop attempt during rendering. The drop target reported busy and the final source/export remained correctly tied to the original demo.
- Desktop and 375 px narrow-mobile full-page screenshots were reviewed for overflow and legibility. **Unverified:** subjective audible listening and current iOS Safari/Android-device playback; neither is claimed as passed.

## Rust/WASM status

**Rust/WASM is not used in this version.** The working TypeScript boundary is `src/audio/math.ts` for trim validation, rate-to-duration math, finite peak measurement, and peak-guard gain selection. A later Rust DSP module can replace those deterministic calculations only after it is compiled to WASM, imported into `src/audio/engine.ts`, and verified in the live pipeline. Reverb, filters, rate conversion, preview, and render graph should remain browser Web Audio responsibilities.

## Deferred features and proposed billing

Not implemented: MP3/AAC export, ZIP/batch export, vertical MP4/visualizer output, reusable presets, accounts, any enforcement of paid features, and payments. Vertical video export is a future feature, not a button.

The proposed **Creator** plan is clearly pre-launch only: $4.99/month for a future preset library, batch processing, and vertical video export. A real billing version should use server-created checkout sessions, verified payment webhooks, authenticated entitlements, server-only secret keys, cancellation/account management, and clear recurring-price disclosure. Browser-only quotas or feature locks are not secure payment enforcement.

## Next build priorities

1. **Native browser/device compatibility validation:** test the exact audio graph on current iOS Safari and Android Chrome, then document concrete support findings.
2. **Creator-grade editing value:** reusable local presets and clearly bounded batch processing, keeping privacy behavior transparent.
3. **Visual output:** a real vertical video/visualizer export pipeline, after determining its asset/right/compute constraints.
4. **Commercial and rights validation:** legal/trademark review and creator rights guidance, independently from core editing.
5. **Payments only after authorization:** introduce the secure server-backed billing architecture above after credentials and explicit payment approval exist.
