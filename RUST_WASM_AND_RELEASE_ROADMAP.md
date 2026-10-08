# AudioFlip: Rust/WASM and public-release roadmap

> **Status:** planning only. No Rust toolchain, accounts, database, Stripe integration, live keys, checkout, public release, or deployment was enabled while preparing this roadmap.

## Current baseline

AudioFlip is a Vite/React/TypeScript static web app. It processes audio in browser memory using Web Audio and `OfflineAudioContext`; the project has no server/database capability, no application login, no analytics, no payment code, and auto-publishing is off.

A toolchain check in the current workspace found **no `rustc`, Cargo, rustup, wasm-pack, wasm-bindgen, or installed WASM target**. The existing TypeScript safety boundary is deliberately concentrated in `src/audio/math.ts`, while the browser graph in `src/audio/engine.ts` owns decoding, playback, rate conversion, reverb, filters, and offline render.

## 1. Rust/WASM: use it where it can actually help

### First principle

Rust/WASM should target **CPU-heavy, deterministic buffer work**. It will not accelerate browser-owned `decodeAudioData`, `OfflineAudioContext` scheduling, native rate conversion, native filters, or convolver rendering. For the current one-clip, 20 MB / 60-second MVP, peak scanning and PCM writing are normally small compared with offline graph work.

> Add Rust only after profiling shows meaningful main-thread cost in sample scans, gain application, custom DSP, or batch work. Keep Web Audio for the effects graph.

### Recommended first scope

Start with a small WASM DSP module that accepts interleaved `f32` PCM and exposes four pure functions:

| Function | Responsibility | Why it belongs in WASM |
| --- | --- | --- |
| `scan_peak` | Ignore non-finite samples and return absolute peak | Predictable O(n) sample scan, easy TypeScript parity test |
| `safe_gain` | Convert a peak/ceiling to a gain factor | Small but forms a stable DSP contract |
| `apply_gain_in_place` | Apply gain and clamp non-finite/out-of-range samples | Removes a large JavaScript per-sample loop |
| `pcm16_interleave` | Clamp, quantize, and interleave mono/stereo into an output byte buffer | Useful for batch export and reduces JavaScript encoding work |

Do **not** move reverb, low-shelf filtering, Web Audio playback, decode, or `OfflineAudioContext` rendering into Rust in the first iteration. Do not build a custom MP3 decoder/encoder or DSP plugin host merely to replace browser primitives.

### Proposed repository layout

```text
wasm-audio/
  Cargo.toml
  src/lib.rs                 # Deterministic DSP exports only
  pkg/                       # Generated package; never hand-edit
src/audio/
  wasm-dsp.ts                # Async adapter and TS fallback
  worker.ts                  # Optional worker boundary for larger jobs
  math.ts                    # Reference implementation / fallback
  wav.ts                     # Calls wasm PCM helper when ready
  engine.ts                  # Keeps the Web Audio graph
```

### Toolchain and build setup

Create this only in a dedicated, bounded toolchain pass, not as an incidental change to the MVP.

1. Install a pinned stable Rust toolchain and the `wasm32-unknown-unknown` target.
2. Install a pinned WASM binding workflow, preferably `wasm-pack` plus `wasm-bindgen`.
3. Add a `wasm-audio` crate with `crate-type = ["cdylib"]`; use `wasm-bindgen` to define only narrow typed-array interfaces.
4. Add a deterministic project script such as `pnpm build:wasm` that runs `wasm-pack build wasm-audio --target web --release --out-dir pkg`.
5. Make `pnpm build` depend on `build:wasm`, cache the generated package correctly in CI, and fail clearly if a generated artifact is missing.
6. Import the package only through `src/audio/wasm-dsp.ts`, with a dynamic load and a fully tested TypeScript fallback. The UI must still report a normal processing failure—not silently export the original—if WASM loading fails.

A minimal `Cargo.toml` direction:

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "<pinned version>"
```

Pin exact Rust and binding versions in the build documentation/CI after the first successful reproducible build. Do not claim Rust use until the generated `.wasm` is shipped and a browser test exercises it.

### Browser data-flow design

1. Render the selected effect with the existing `OfflineAudioContext`.
2. Copy the final `AudioBuffer` channels into a compact interleaved `Float32Array` only when the WASM path is used.
3. Transfer that buffer to a worker for peak scan, gain, and PCM encoding; return only the generated WAV bytes/metadata to the UI.
4. Create one Blob URL for the current render and revoke the previous one exactly as the current UI does.
5. Keep the existing request-version guard: a late worker/WASM response must be discarded if the user replaces the source or starts a new render.

Use transferable `ArrayBuffer`s initially. Avoid requiring `SharedArrayBuffer`: it needs cross-origin isolation headers and may complicate embedded preview behavior. Do not keep unbounded copies of source, offline-rendered, interleaved, and encoded buffers at the same time; stream/chunk the batch path later if memory profiling requires it.

### Performance acceptance gates

Measure before and after with representative mono/stereo clips at 10 s, 30 s, and the 60 s limit on a throttled mid-range mobile-class browser. Record:

- render latency by stage: offline graph, peak/gain, encode, Blob creation;
- UI responsiveness and long tasks on the main thread;
- peak memory and duplicate buffer count;
- WAV byte-for-byte/header validity and finite/clamped samples;
- numerical parity between TypeScript and WASM peak/gain output within a documented tolerance.

Proceed only if measured gain is meaningful. For the current cap, a worker may improve responsiveness more than Rust alone. Rust becomes more compelling for future batch export, a waveform analysis pipeline, custom dynamics/limiting, or longer offline renders—after those features are explicitly approved.

### Required test additions

- Rust unit tests for silence, NaN/Infinity, mono/stereo, short clips, samples at ±1, and over-ceiling values.
- TypeScript/WASM parity tests for peak, guard gain, clamping, PCM interleave, and WAV length/header.
- Browser integration test: render the demo through every preset with WASM enabled and fallback forced; verify output names, decoded WAV metadata, duration math, and no stale render after source replacement.
- Performance benchmark report committed as a non-sensitive artifact; never retain users’ raw audio in test fixtures.

## 2. Public-release foundation: accounts without blocking the free first result

### Architecture change

The present static app cannot safely create sessions, enforce entitlements, process payment webhooks, or store purchase records. A public release with accounts/payments should become a **hybrid application**:

```text
React/Vite client
  ├─ browser-local free editor and demo (still no source audio upload)
  └─ authenticated account/billing UI
          ↓
Application server
  ├─ OAuth callback and validated application session
  ├─ account/profile and entitlement APIs
  ├─ Stripe Checkout Session creation
  └─ exact-body Stripe webhook verification
          ↓
Managed database
  ├─ user identity mapping
  ├─ entitlements/subscription status
  ├─ purchases/history
  └─ idempotent processed-webhook events
```

Keep the **first free render anonymous**. Login should be required only for account-specific features: billing, creator entitlements, reusable cloud-synced presets if later approved, order history, or account management. This preserves the original product promise and avoids storing audio merely to add an account.

### Account implementation sequence

1. **Decide identity policy.** Unless another provider is explicitly selected, use Manus OAuth. Define whether accounts are only for paying users or available to all creators, and write a privacy/data-retention policy before collecting profile data.
2. **Enable a server and database in a separate approved configuration change.** This is one-way infrastructure enablement, so do not enable it until the release architecture is accepted.
3. **Add durable tables, with additive migrations.** Start with a user identity table keyed by the provider `openId`, a minimal profile record, entitlements, purchases, and processed-webhook events. Do not store raw audio, OAuth tokens, card data, raw webhook payloads, or unnecessary personal data.
4. **Implement the OAuth authorization start/callback routes.** Bind a signed single-use nonce to the initiating browser in a short-lived cookie; exchange the authorization code server-side; retrieve identity; and reject state/nonce mismatch. Redirect only to fixed application paths.
5. **Implement application session validation.** Preserve `webdev_app_session` for Preview compatibility, validate the supplied JWT with `MANUS_JWT_SECRET` using HS256, check expiry and expected application ID, then resolve authorization from the app’s own user/role data. Never use the platform access gate as if it were app login.
6. **Set correct cookie behavior.** Public Preview is embedded cross-site, so application cookies need `SameSite=None; Secure` there. Do not infer these from the internal HTTP request scheme or `NODE_ENV`. Test login in both the embedded preview and a standalone browser tab.
7. **Add basic account routes/UI.** Logged-out state, sign-in, sign-out, profile view, Creator entitlement state, purchase history, and a privacy/delete-account process. Use real session/role checks on every protected server action.

### Minimal durable model

| Record | Essential fields | Constraints |
| --- | --- | --- |
| `users` | internal ID, provider `openId`, name/email only if required, timestamps | unique `openId` |
| `entitlements` | user ID, plan, status, Stripe customer/subscription IDs, effective period | unique active subscription mapping; server is authority |
| `orders` | user ID, Stripe checkout/payment IDs, amount/currency/status/item/date | keep business facts, not payment secrets |
| `processed_stripe_events` | Stripe event ID, event type, received/processed timestamps | unique event ID for idempotency |
| `presets` (future) | user ID, user-authored JSON preset values, timestamps | no raw source audio/audio bytes |

## 3. Payment integration: Stripe Checkout plus verified entitlements

The session-level Stripe and Stripe API connectors are currently disabled, and no project Stripe integration exists. That is expected for the private MVP. A public payment build should use the platform-managed project Stripe path—not browser-only locks, a client-held secret, or manually invented environment variables.

### Prerequisites and decisions

Before implementation, settle these product/legal choices:

- Creator product definition and exact recurring price/currency; whether the proposed $4.99 is still correct;
- countries/regions, taxes/VAT/GST, refund and cancellation policy, customer-support flow, and required disclosures;
- whether to use an existing Stripe merchant account and who is authorized to claim/configure it;
- explicit Terms, Privacy, acceptable-use/copyright language, and retention/deletion policy;
- how Creator is technically enforced without uploading user audio (for example, server-held entitlement checked for batch/preset/video features).

### Stripe implementation sequence

1. **After server/database approval, enable the project’s managed Stripe integration.** Use the dedicated `integrations/stripe/enable` flow. It provisions the platform-managed secret/publishable/webhook declarations and registers the supported webhook path. Do not ask a user to paste those generated keys or create duplicate webhooks manually.
2. **Confirm sandbox availability and current Preview webhook binding.** Connect the current Cloud Preview webhook using the supported configuration call, then read the resulting configuration. Registration alone is not proof that the application handler works.
3. **Centralize product/price IDs on the server.** Keep one source of truth for Free/Creator offerings and environment mapping. Never trust a client-submitted price, plan, user ID, or entitlement.
4. **Create Checkout Sessions server-side.** An authenticated endpoint should look up the application user, create a subscription Checkout Session, attach `client_reference_id` and `metadata.user_id`, pass verified email/name when appropriate, set the actual browser-visible success/cancel URLs, and return only the Checkout URL to the client. The client opens it in a new tab and makes no entitlement decision.
5. **Verify raw webhook bytes and signatures.** Implement `POST /api/stripe/webhook` with no JSON parser before signature verification. Verify with `STRIPE_WEBHOOK_SECRET`, record the event ID first, and make processing idempotent. Handle the six delivered event types: checkout completion, payment success/failure, and subscription creation/update/deletion.
6. **Grant/revoke only from durable fulfillment records.** The return URL is navigation—not payment proof. A completed checkout, invoice failure, subscription cancellation, or repeated webhook must change entitlement state correctly and repeatably.
7. **Provide customer operations.** Add `/orders` or `/payments`, plan/status/renewal data, cancellation/account-management access (such as a Stripe customer portal or an explicit managed flow), and honest pending/failed states. Do not fake successful subscription status.
8. **Test the full sandbox lifecycle.** Use Stripe’s documented test card `4242 4242 4242 4242`; test a successful checkout, cancel, payment failure, webhook redelivery, duplicate event, subscription cancellation, login/logout, and entitlement enforcement. A USD charge must meet the provider minimum (currently at least $0.50).
9. **Go live only after separate release approval.** Claim the sandbox as required, configure live keys through the supported owner dashboard flow, verify the production webhook against the published domain, republish, run a smoke purchase/refund/cancellation check, and only then publicly launch.

## 4. Security and release gates

| Gate | Required evidence before a public launch |
| --- | --- |
| Audio privacy | Source audio remains local; no raw audio in logs, database, analytics, error reports, or support attachments by default. |
| Auth | State/nonce verified; session JWT/app ID validated; role/entitlement checks server-side; secure cookie behavior tested. |
| Billing | Server-created Checkout; raw-body signature verification; idempotent event table; no card/token/raw payload persistence; account/cancel/history UI. |
| Content/rights | Clear ownership/permission reminder, takedown/support process if user content becomes stored, and trademark/legal review of “AudioFlip.” |
| Quality | Current browser support matrix, mobile Safari/Android audio testing, accessibility keyboard/touch review, load/error/race tests, and production monitoring/error handling. |
| Commercial clarity | Exact recurring amount/currency/renewal disclosure, refund/cancellation policy, privacy policy, terms, tax approach, and support contact. |
| Release control | Explicit approval to publish, verified production domain/configuration, and an audited rollback plan. |

## Recommended ordering

1. **Profile first.** Decide whether a worker alone solves the current responsiveness problem before funding Rust/WASM work.
2. **Build the account/server/database foundation.** Keep free local editing anonymous.
3. **Build and test durable entitlements.** There is no secure Creator feature gate without this step.
4. **Add Stripe sandbox Checkout/webhook flows.** Test the complete lifecycle, not merely a success page.
5. **Complete policy, rights, browser/device, accessibility, and security work.**
6. **Seek a separate explicit public-release decision.** Only then configure production payment credentials and publish.
