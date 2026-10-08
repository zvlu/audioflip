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
