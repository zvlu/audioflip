# Rust/WASM gate record — 2026-10-08

## Outcome

**Rust/WASM is not shipped.** AudioFlip remains a private, browser-local React/TypeScript application using Web Audio plus the tested TypeScript peak-guard and PCM16 WAV path.

## Fresh environment check

Before any Rust implementation attempt, the active Sandbox ran:

```sh
for command_name in rustc cargo rustup wasm-pack wasm-bindgen wasm-opt; do
  command -v "$command_name" && "$command_name" --version
 done
rustup target list --installed
```

Observed result: `rustc`, `cargo`, `rustup`, `wasm-pack`, `wasm-bindgen`, and `wasm-opt` were all **missing**. No installed Rust/WASM target was available because `rustup` was absent.

## Decision

No toolchain installation was attempted. The current scope permits one straightforward setup path only when a ready path and a technically enforceable run budget are available; neither condition was present. Installing Rust, a WASM target, and a binding tool would be a separate toolchain-provisioning pass with nontrivial recovery risk, which conflicts with the no-toolchain-fight instruction.

The user supplied an implementation maximum for this pass, but the runtime exposes no native per-run credit cap and does not expose account/project consumption here. That value is therefore not treated as a verified balance or technically enforceable spending limit.

## Working fallback preserved

- `src/audio/engine.ts` renders effects through `OfflineAudioContext` and invokes the shared TypeScript peak-protection path.
- `src/audio/math.ts`, `src/audio/validation.ts`, and `src/audio/wav.ts` validate bounds, sanitize samples, preserve one shared stereo gain, and emit validated PCM16 WAV output.
- No Rust crate, generated `.wasm`, `wasm-bindgen` output, worker, runtime dynamic import, or hidden Rust dependency exists in the repository.
- The ordinary `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm build` flow remains TypeScript-only and reproducible.

## Best next step

Attempt Rust only in a separately approved, budgeted environment that already has—or is explicitly approved to install—a pinned `rustc`/Cargo toolchain, `wasm32-unknown-unknown` target, and one binding workflow. The first narrow integration should apply finite-sample sanitation and shared peak gain to rendered PCM after `OfflineAudioContext`, retain the TypeScript path as a tested fallback, and prove browser execution before any performance claim.
