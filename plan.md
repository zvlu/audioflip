# AudioFlip MVP plan

## Product and implementation

AudioFlip is a mobile-first browser audio editor for short-form creators. The single-page React/TypeScript application will keep source files, decoded buffers, effect rendering, preview, and export in the visitor's browser. There is no application server, storage bucket, authentication, analytics, external API, or payment integration.

The app will use the Web Audio API as the working audio engine. It will decode an uploaded file, hold only the current source `AudioBuffer`, draw a clear source/progress preview, construct the selected graph in an `OfflineAudioContext`, protect output amplitude from the rendered peak, and serialize the render to 16-bit PCM WAV. A generated tone-and-percussion demo is created locally in code rather than fetched as an asset. The same render settings power processed preview and export. Rate controls intentionally alter both duration and pitch.

A small deterministic TypeScript DSP layer will own trim validation, output-duration calculation, finite-sample peak measurement, and peak-guard gain selection. The browser graph will own resampling, reverb, and filters. Rust/WASM is deliberately deferred: Rust tooling may exist, but adding a build chain is not necessary to deliver a working, testable browser MVP. `README.md` will define the DSP module as the future WASM replacement boundary and explicitly state that Rust/WASM is not used in this version.

### Required behavior

- Accept local WAV/MP3 first, then rely on actual `decodeAudioData` compatibility for any other selection. Reject files above 20 MB and decoded clips over 60 seconds before rendering.
- Support drop and file-picker upload; replacing or clearing a source releases generated object URLs and audio references.
- Let users set valid trim start/end values, choose Original, Slowed + reverb, Sped up, Nightcore-style, or Bass boost, adjust the relevant amount, stop the active player before a new preview, reset settings without clearing the loaded clip, and download a genuine processed WAV.
- Process Slowed + reverb at 0.65–1.00x / 0–40% wet, Sped up at 1.00–1.50x, Nightcore-style at 1.10–1.60x plus a modest brightness filter, and Bass boost at 0–12 dB around 120 Hz. Outputs must preserve mono sensibly or retain stereo, clamp invalid samples, handle silence and very short audio, and avoid keeping historical renders.
- Present final rendered duration and file type, clear disabled/loading/error states, keyboard focus, touch-sized controls, privacy and rights guidance, realistic pre-launch plan language, and an honest future-feature modal with no checkout or data capture.

## Architecture and project structure

```text
src/
  App.tsx                 Product screen and accessible editor state
  main.tsx                React bootstrap
  styles.css              Mobile-first visual system and responsive layout
  audio/
    types.ts              Effect, source, and render contracts
    math.ts               Trim/rate/peak utility functions
    demo.ts               Local, original demo-buffer synthesis
    engine.ts             Decode, preview, OfflineAudioContext graph/rendering
    wav.ts                PCM 16-bit RIFF/WAVE encoder
  components/
    [small presentational components if needed]
tests/
  audio.test.ts           Deterministic utility and WAV-structure coverage
public/
  manus-routes.json       Route declaration for the single page
plan.md                   This build/design plan
TODO.md                   Requirement-grounded delivery checklist
README.md                 Setup, support, limits, and future boundary notes
```

Vite will serve the static React client on the configured private preview port. Production build output is static but will not be published or deployed in this task.

## Design direction

- **Design movement:** Night-mode music hardware meets clipped editorial posters—an expressive, utility-first audio workstation rather than a generic dashboard.
- **Core principles:** immediate action over explanation; high contrast for capture-ready demos; one-handed control density; every visual flourish maps to a real audio setting.
- **Color philosophy:** charcoal and near-black make bright electric violet feel energetic while lime serves as the intentional signal for ready/safe/active states. White/soft gray preserve readability without a neon overload.
- **Layout paradigm:** a vertical "signal path"—hero, source lane, effect lane, render lane—uses full-width stacked modules on phones rather than a centered desktop control grid.
- **Signature elements:** a small waveform-style logomark; slim lime play/progress lines; outlined violet effect cards with highly visible active-state borders.
- **Interaction philosophy:** controls respond as physical controls: selecting a preset establishes its defaults, changing a parameter marks a deliberate custom setting, and render/download cannot be confused with a cosmetic mockup.
- **Animation:** use only short opacity/color transitions for status and selected controls; no autoplaying movement or heavy animation.
- **Typography system:** a tight, broadly available sans-serif stack with oversized, tracking-adjusted headings; tabular figures for duration and settings; readable 16px+ body text.
- **Brand essence:** Local-first sound flips for creators who want an honest before/after in moments. **Personality:** kinetic, direct, trustworthy.
- **Brand voice:** short, candid, and explicit about boundaries. Examples: “Flip your sound in a few taps.” and “Made on this device. Nothing uploaded.”
- **Wordmark and logo:** `A`-shaped waveform notch paired with a split/flip chevron, reinforced in the first wordmark letter and the small favicon.
- **Signature brand color:** **Flip Violet** (`#8b5cf6`)—the deliberate action color, paired sparingly with lime feedback.

## Material constraints

The project will not use stock imagery, generated marketing visuals, copyrighted music, media downloaders, public deployment, paid plans, email capture, accounts, analytics, or a server. A browser with `AudioContext`, `OfflineAudioContext`, `decodeAudioData`, and Blob download support is required for full processing. Safari/mobile audible testing is only reported if it can be performed, not implied by screenshots.


## Phase 2 core-hardening amendment

**Accepted scope:** Core hardening only. Rust/WASM, workers, accounts, payment integration, deployment, batch/video/alternate export formats, and any expansion of the 20 MiB / 60-second limits remain deferred.

The editor will keep its browser-local React/Web Audio architecture and visual language. Phase 2 adds a small portal-style accessible Creator modal component rather than a UI library, with focus entry, Tab/Shift+Tab containment, Escape/backdrop close, background inerting/scroll lock, and trigger-focus restoration. `App.tsx` will gain explicit clip clearing and job/playback identity guards so late decode/render completion cannot overwrite a clear, reset, newer source, or unmount.

The decorative bar field will become a labeled playback-progress indicator, explicitly not a waveform. The Web Audio engine will validate source metadata, effect settings, trim/rate values, output duration, and offline allocation bounds at the render boundary; it will preserve TypeScript peak-derived shared-channel gain and PCM16 WAV output. The WAV encoder will reject unsafe metadata/allocation requests rather than silently coercing them. New deterministic tests cover validation, allocation/format safety, finite sample behavior, and keyboard modal focus behavior; browser checks will exercise the actual editor loop and cleanup behavior.


## Rust/WASM gate disposition — 2026-10-08

A fresh active-Sandbox check found no `rustc`, Cargo, rustup, installed WASM target, `wasm-pack`, `wasm-bindgen`, or `wasm-opt`. The user supplied an implementation maximum, but the runtime provides no native per-run spending cap and does not expose verified account/project consumption. Under the one-path/no-toolchain-fight constraint, no Rust installation was attempted. The reliable TypeScript DSP path remains the shipped implementation; no worker or WASM runtime path was added.


## Phase 3 — local vertical-video export and portfolio polish

**Scope and release boundary:** Build within the existing React/Vite/TypeScript browser-only editor. The repository is currently private, and this pass keeps it private: no deployment, domain, backend, account, payment, analytics, key, or Rust/WASM setup. “Portfolio project” describes the source and product work, not a public release. Rust/WASM remains deferred.

**Implementation approach:** Add a focused `src/video/export.ts` browser module rather than restructuring the audio editor. It will contain pure helpers for runtime MIME selection (`video/mp4`, then VP9 WebM, then WebM), 40-character title cleanup, caption text, and 9:16 size selection; those helpers receive browser capabilities as arguments so Vitest can test them without MediaRecorder. Its browser-only export function will create an off-DOM 720×1280 or 1080×1920 canvas, animate violet/lime analyser bars from the rendered `AudioBuffer`, and record the canvas stream plus a `MediaStreamAudioDestinationNode` stream into a native `MediaRecorder`. It will cap output at 60 seconds, use the selected MIME’s matching extension, expose progress/cancel/disposal behavior, and retain no source/audio history.

`App.tsx` will keep its current editor state model and add only video-result state, URL revocation, a title field, export progress/cancel controls, caption copying, and supported-file Web Share. Result invalidation, clear, reset, source replacement, setting changes, new renders, and unmount will cancel an in-flight video export and revoke its URL. A direct Try the demo path will render the local demo with the default slowed+reverb setting so the result and video action are reachable without manual effect configuration.

**Design continuation:** Preserve the existing dark charcoal, violet, and lime sound-lab look. The export canvas uses the same motion-language as the product—calm analyser bars, large effect name, small optional title, restrained time indicator, and `made with AudioFlip` footer—with `prefers-reduced-motion` respected in the page UI. The product remains touch-first: the result card groups WAV/video/post actions with clear disabled, progress, failure, and unsupported-browser states. Copy follows the direct, honest brand voice: “Make a clip worth posting,” never “post directly to TikTok.”

**Files and static delivery:** Expected additions are `src/video/export.ts`, `tests/video-export.test.ts`, and `LICENSE`; expected edits are `src/App.tsx`, `src/styles.css`, `src/types.ts` only if a shared contract is warranted, `README.md`, `TODO.md`, and `index.html`. No large UI, recording, or media library will be added. Vite’s existing `pnpm build` remains a static `dist` output suitable for a conventional Vercel or Netlify static deployment, without deploying it here. Social metadata will use the existing durable logo URL for `og:image`; no canonical or `og:url` will be invented because no public origin is configured.


## Phase 4 — worker peak fallback and Vercel release

**Scope and deployment choice:** The user has authorized a public static release to bypass the temporary Preview hostname filter. Vercel is selected over Netlify because the current task already has an enabled Vercel connector and the source is the GitHub repository `zvlu/audioflip` on `main`. This remains a browser-only static site: no server, database, account, payment, analytics, raw-audio upload, or new secret is introduced. The build must remain `pnpm install --frozen-lockfile && pnpm build`, serving `dist`.

**Worker hardening approach:** Implement a small, module-worker peak service at `src/audio/peak-worker.ts` and `src/audio/peak-service.ts`. The worker receives **copied**, transferable `Float32Array` channel buffers only—never an `AudioBuffer` backing store—then reports a finite peak and shared guard gain. `engine.ts` will await this service after `OfflineAudioContext` rendering and before safe-buffer generation. The existing TypeScript `peakOf` + `peakGuardGain` path remains the mandatory fallback for small buffers, missing/failed workers, allocation failure, malformed worker messages, errors, and timeouts; no failure can bypass peak guarding. The worker service keeps a single reusable worker, has bounded pending jobs, terminates/recreates it after a failure or timeout, transfers temporary copies, and never persists audio.

**Memory and lifecycle constraints:** Use the worker only above a documented sample threshold, reject unsafe transfer byte estimates before copying, and fall back to the current main-thread scan if memory work cannot safely start. Main-thread safe-buffer creation and WAV encoding stay unchanged. The App’s existing work-version guards already discard late `renderEffect` results after clear/replacement/unmount; the worker service must settle (or fall back from) every promise so the editor cannot remain in a busy state.

**Static Vercel delivery:** Add `vercel.json` declaring the Vite build command and `dist` output. Create or reuse a Vercel Git project linked to the existing `main` branch, relying on Vercel’s default deployment protection rather than weakening access controls. After the first successful production URL is known, add only accurate canonical/Open Graph URL metadata, commit it, and allow the connected Git production deployment to update. No domain purchase, custom domain, payment, or DNS change is in scope.

**Project structure addition:**

```text
src/audio/
  peak-worker.ts       Module-worker finite peak scan and typed message protocol
  peak-service.ts      Threshold, copied-transfer, timeout, and TypeScript fallback orchestration
vercel.json            Static Vite deployment declaration
```

**Validation and evidence:** Add deterministic coverage for worker-threshold/byte guards, copied channel transfer safety, malformed-result/failure fallback behavior, and finite shared gain. Build and test before every checkpoint. Validate the browser’s actual worker route where supported, then inspect the Vercel production deployment response, emitted static assets, and browser page load. Documentation will distinguish tested Chromium behavior from untested mobile/WebKit surfaces and record any unavailable worker capability honestly.


## Phase 5 — cancellable worker jobs and safe-buffer allocation fallback

**Scope:** Close two remaining browser-memory/lifecycle gaps without adding dependencies, backends, storage, new effects, or Rust/WASM. The design and static Vercel delivery remain unchanged.

**Cancellable peak-worker path:** Extend `peak-service.ts` with an optional `AbortSignal`. A pending worker scan will retain only the rendered `AudioBuffer` reference needed for its main-thread safety fallback. On explicit abort, it must remove its listener/timer, terminate the current worker, release the pending reference, and reject with a recognizable cancellation error instead of scanning/allocating a result that the UI has already discarded. Missing Worker APIs, construction/copy/postMessage errors, malformed replies, error events, and timeouts still resolve through the current main-thread peak guard. The default one-job service remains bounded and will recreate the worker on the next eligible job.

**Render lifecycle integration:** `renderEffect` will accept the signal, check it before/after offline rendering and before safe-buffer creation, and pass it to peak measurement. `App.tsx` will retain one `AbortController` for the current render. Every existing `invalidateWork` transition—clear, source replacement, setting/trim/effect change, reset, new render, and unmount—will abort that controller first. Cancellation remains silent for stale work; real audio failures retain the existing helpful error state. Browser `OfflineAudioContext` itself is not force-cancelled; once it settles, no worker copy, safe buffer, Blob, or stale state update may be created.

**Safe-buffer allocation fallback:** `engine.ts` will allocate the peak-guarded output using the global `AudioBuffer` constructor first, then fall back to `OfflineAudioContext.createBuffer` from the already-created offline context. Both allocations feed the exact same finite-sample / guard-gain copy loop. If neither allocator can produce a correctly shaped buffer, rendering fails truthfully and creates no preview/download; it never reuses or downloads unguarded source data.

**Tests and documentation:** Add deterministic tests for pending-job abort cleanup, aborted signals before dispatch, fallback reuse after a later job, and global-to-context output-buffer allocator fallback. Update README/TODO to state that cancellation disposes pending worker work rather than claiming universal offline-render cancellation. The deployment URL and public static architecture remain unchanged.
