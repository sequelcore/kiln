# Voice Capability

## Status

This is the canonical architecture record for Kiln's voice capability contract
as of 2026-05-16.

The current implementation baseline includes speech-to-text ingress for gateway
audio messages, concrete OpenAI and Deepgram speech-to-text adapters, concrete
OpenAI and ElevenLabs text-to-speech adapters, local Whisper-compatible STT and
Kokoro-compatible TTS command adapters, governed assistant-output synthesis in
the admitted-turn runtime pipeline, named TTS profiles with one-turn intent
overlays, synthesized-audio artifact retention, recorder voice-track support
through injected adapters, app-level `voice` policy configuration in
`@kilnai/core`, global `operatorVoice` policy for local operator surfaces,
shared voice-input part creation, and shared audio-output projection for
operator surfaces.

## Purpose

Voice is a governed capability over Kiln's existing multimodal, artifact,
session, and surface model. It covers:

- speech-to-text input
- text-to-speech output
- surface admission policy
- artifact retention policy
- replay and observability evidence

Voice is not a separate product plane and not a per-channel prompt convention.
Every surface projects the same app-level contract in the form appropriate for
that surface.

## Ownership Boundaries

Core owns the provider-neutral voice configuration and validation contract:

- `VoiceConfig`
- `SttProviderConfig`
- `TtsProviderConfig`
- `VoicePolicyConfig`
- `VoiceSurfacePolicy`

Runtime owns transforms, provider adapter construction, artifact writes,
session events, and gateway integration.

Surfaces own capture and playback presentation only. GUI, TUI, CLI, SDK,
widget, API, WebSocket, and channel gateways must not define alternate voice
semantics.

CLI owns global operator config loading and adapter construction for
developer-local surfaces. It may inject `operatorVoice` and local adapters into
GUI, TUI, and native operator transports, but it must not create a separate
voice schema.

## Configuration Contract

Apps declare voice at the top level:

```yaml
voice:
  stt:
    provider: openai
    model: gpt-4o-transcribe
    apiKeyEnv: OPENAI_API_KEY
    language: es
  tts:
    provider: openai
    model: gpt-4o-mini-tts
    apiKeyEnv: OPENAI_API_KEY
    voice: alloy
  defaults:
    ttsProfile: assistant-default
  ttsProfiles:
    assistant-default:
      style: calm, concise customer assistant
      voice: alloy
      language: es
      speed: 1
      speedRange: [0.95, 1.05]
      format: mp3
      intents:
        neutral:
          delivery: Use the profile's normal delivery.
          appliesWhen:
            - Default spoken response when no more specific intent applies.
          speed: 1
        calm:
          delivery: Slightly slower and steadier delivery.
          appliesWhen:
            - Errors, support friction, or sensitive user messages.
          speed: 0.97
  policy:
    defaultInputFailureMode: fail-open
    defaultOutputFailureMode: fail-closed
    artifacts:
      storeSourceAudio: true
      storeTranscripts: true
      storeSynthesizedAudio: true
      retentionMaxArtifacts: 50
    surfaces:
      whatsapp:
        enabled: true
        input:
          modes: [audio-part]
          failureMode: fail-open
      gui:
        enabled: true
        input:
          modes: [microphone, file]
        output:
          modes: [audio-on-demand, transcript-only]
          failureMode: fail-closed
```

Operators declare local voice at the top level of `~/.kiln/config.yaml`:

```yaml
version: "1"
operatorVoice:
  stt:
    provider: whisper-local
    model: base
    commandEnv: KILN_WHISPER_COMMAND
  tts:
    provider: kokoro-local
    model: kokoro-v1
    commandEnv: KILN_KOKORO_COMMAND
    voice: af_bella
    format: wav
  policy:
    defaultInputFailureMode: fail-closed
    defaultOutputFailureMode: fail-closed
    surfaces:
      gui:
        enabled: true
        input:
          modes: [microphone, file]
      tui:
        enabled: true
      native:
        enabled: true
        input:
          modes: [microphone, file]
```

`voice` is deployable app policy. `operatorVoice` is machine-local operator
policy. They intentionally share the same value object so validation, surface
policy, provider selection, profiles, and failure semantics stay identical.

Supported surfaces are:

- `api`
- `web`
- `whatsapp`
- `messenger`
- `instagram`
- `gui`
- `native`
- `tui`
- `cli`
- `sdk`
- `widget`
- `recorder`

Supported input modes are `audio-part`, `microphone`, and `file`.

Supported output modes are `audio-response`, `transcript-only`,
`artifact-only`, and `audio-on-demand`. `audio-on-demand` is the preferred
operator-surface mode when text remains canonical and audio is generated only
after an explicit GUI, TUI, or native surface action.

Failure modes are:

- `fail-open`: continue through a configured degraded path when available and
  record the degradation.
- `fail-closed`: stop before provider execution or response emission when the
  voice capability cannot be satisfied.

## Local Provider Boundary

Local voice providers are runtime adapters, not surface features and not a
second voice control plane. The app contract selects `whisper-local` for STT or
`kokoro-local` for TTS; runtime resolves the configured local command and passes
one JSON request over stdin, then reads one JSON response from stdout.

Local provider configuration may include:

- `command` or `commandEnv`
- `args`
- `model`
- `modelPath` or `modelPathEnv`
- `device`
- `timeoutMs`
- `language` for STT when the deployment intentionally disables language auto-detection
- `voice` and `format` for TTS

Kiln does not install local engines, download models, probe model directories,
or silently fall back to a cloud provider. Missing command configuration fails
before adapter construction. Invalid command output, non-zero exit status,
timeout, or malformed JSON fails the operation as governed STT/TTS failure
evidence.

## Voice Profiles

`voice.ttsProfiles` is the governed voice identity layer. Profiles are owned by
core configuration and consumed by runtime synthesis. They must declare a stable
`style` and may set voice id, language, output format, default speed, a narrow
`speedRange`, and named intents.

Agents reference profile ids with `voiceProfile`. Runtime may also receive a
one-turn output intent from an admitted surface or orchestration path. The intent
is an overlay on the selected profile for that synthesis call only; it does not
mutate the agent, session, app config, or provider adapter. Unknown intents are
ignored rather than treated as free-form synthesis parameters.

Intent ids are a closed semantic catalog: `neutral`, `calm`, `brief`, and
`careful`. Every configured intent must declare `delivery` and `appliesWhen`.
Those fields are governance metadata for humans, routers, and future selection
logic; provider adapters receive only concrete synthesis options such as voice,
speed, format, and language.

This keeps voice personality stable while still allowing controlled delivery
changes that match how the agent is speaking, such as `calm` for error recovery,
`brief` for acknowledgements, or `careful` for dense instructions. Surfaces must
not expose arbitrary provider parameters as voice controls.

Runtime owns automatic intent selection. It evaluates the final assistant text
after egress and grounding policy, plus runtime escalation evidence, and chooses
only from intents declared by the active TTS profile. Explicit admitted intent is
preserved when valid; otherwise selection falls through `calm`, `careful`,
`brief`, then `neutral`. This keeps GUI, TUI, API, native, SDK, widget, and
channel projections consistent because surfaces receive the same synthesized
audio result instead of running their own tone logic.

## Cross-Surface Projection

All surfaces consume the same `VoiceConfig`:

- webhook channels accept retained audio parts and route them through governed
  transcription
- API and SDK calls may submit audio content parts under multimodal admission
  and receive response `parts` alongside assistant text
- GUI and widget microphone and audio file controls create canonical audio
  content parts through `@kilnai/gateway-contracts/voice-input-parts`
- GUI App Gateway and native GUI gateway WebSocket message frames carry
  explicit input `parts` into the admitted-turn pipeline
- local GUI, TUI, and native operator transports may inject `operatorVoice`
  from global config into the same admitted-turn pipeline
- Gateway WebSocket `done` frames carry response `parts` for GUI, TUI, native,
  and widget projections
- GUI and widget render audio output parts as compact playback actions plus artifact
  links when an artifact URI is available
- WhatsApp, Instagram, and Messenger publish synthesized assistant audio
  artifacts as short-lived signed HTTPS media URLs when the channel binding
  declares a public media base URL and signing secret. WhatsApp delivers those
  URLs with Cloud API `audio.link`; Instagram and Messenger deliver them as
  Send API `audio` attachments.
- TUI projects audio output parts as terminal artifact text
- native advertises shared voice input capture and output playback capability
  slots while leaving provider policy in the app contract
- CLI surfaces may expose file input, transcript output, and artifact links
- recorder sessions may synthesize narration tracks and preserve evidence

Differences are presentation only. A surface can expose fewer controls than
another surface, but it cannot change provider choice, failure policy,
artifact policy, or replay semantics.

For operator direct surfaces, audio ingress is transformed inside
`processAdmittedTurn` before tenant routing, task-shape analysis, knowledge
retrieval, or provider execution. This keeps GUI, TUI, and native direct
sessions from bypassing the governed STT path and prevents raw audio from being
sent to a text-only model route.

## Evidence Model

Voice operations must produce durable evidence when they alter the turn:

- source audio artifact URI when retained
- transcript text and confidence when available
- synthesized audio artifact URI when retained
- provider and model used
- failure mode decision
- degradation reason
- surface that admitted the operation

This evidence belongs in the same session and artifact model as other
multimodal transforms. Audio transcription is a transform with provenance, not
plain text magically inserted into the user message.

## Invariants

- No surface-local voice contract.
- No hidden STT or TTS fallback.
- No implicit local model download or sidecar startup.
- No agent-generated arbitrary voice id, format, provider, or synthesis speed.
- No custom TTS intent ids outside the governed semantic catalog.
- No TTS intent without an explicit delivery description and applies-when rule.
- No surface-local automatic tone selector.
- No placeholder transcript may be sent to a model after failed transcription.
- No operator direct surface may send raw audio to a provider when
  `operatorVoice` can govern transcription.
- No synthesized audio may be emitted without provider, model, and artifact
  evidence when retention is enabled.
- No provider adapter may own app-level policy.
- No operator surface may bypass `voice.policy` when the app declares it.

## Implementation Map

Current contract and implementation entry points:

- `packages/core/src/engine/domain/speech-config.ts`
- `packages/core/src/engine/loader/app-loader.ts`
- `packages/core/src/engine/composites/app.ts`
- `packages/core/src/agents/infrastructure/openai-stt.ts`
- `packages/core/src/agents/infrastructure/deepgram-stt.ts`
- `packages/core/src/agents/infrastructure/openai-tts.ts`
- `packages/core/src/agents/infrastructure/elevenlabs-tts.ts`
- `packages/runtime/src/gateway/stt-factory.ts`
- `packages/runtime/src/gateway/tts-factory.ts`
- `packages/runtime/src/gateway/local-voice-adapters.ts`
- `packages/runtime/src/gateway/audio-preprocessor.ts`
- `packages/runtime/src/gateway/voice-output-synthesizer.ts`
- `packages/runtime/src/gateway/voice-output-intent-selector.ts`
- `packages/runtime/src/gateway/message-pipeline.ts`
- `packages/cli/src/config/global-config.ts`
- `packages/cli/src/config/operator-voice.ts`
- `packages/cli/src/commands/gui.ts`
- `packages/cli/src/commands/tui.ts`
- `packages/runtime/src/gateway/gui-gateway.ts`
- `packages/runtime/src/gateway/tui-gateway.ts`
- `packages/runtime/src/gateway/operator-gateway.ts`
- `packages/runtime/src/interactive/recorder-voice-track.ts`
- `packages/gateway-contracts/src/voice-input-parts.ts`
- `packages/gateway-contracts/src/voice-output-parts.ts`
- `packages/sdk/src/use-kiln-chat.ts`
- `packages/runtime/src/gateway/gui-frame-parts.ts`
- `packages/gui/src/components/composer.tsx`
- `packages/gui/src/components/message-row.tsx`
- `packages/widget/src/ws-client.ts`
- `packages/widget/src/widget.ts`
- `packages/widget/src/voice-parts.ts`
- `packages/tui/src/gateway-session.ts`
- `packages/native/src/shared/native-surface.ts`

Channel outbound media delivery uses channel-owned artifact-to-public-media
bridges. The runtime audio artifact is the evidence source, not itself a public
media URL, and every external channel must project it through the same signed
media boundary instead of introducing surface-local config.

## Verification

Canonical deterministic verification:

```bash
bun run typecheck
bun run test
bun run build
```

Focused coverage lives in:

- `packages/core/tests/engine/domain/speech-config.test.ts`
- `packages/core/tests/engine/loader/app-loader.test.ts`
- `packages/runtime/tests/gateway/audio-preprocessor.test.ts`
- `packages/core/tests/agents/infrastructure/openai-tts.test.ts`
- `packages/core/tests/agents/infrastructure/elevenlabs-tts.test.ts`
- `packages/runtime/tests/gateway/stt-factory.test.ts`
- `packages/runtime/tests/gateway/tts-factory.test.ts`
- `packages/runtime/tests/gateway/local-voice-adapters.test.ts`
- `packages/runtime/tests/gateway/message-pipeline.test.ts`
- `packages/runtime/tests/gateway/voice-output-intent-selector.test.ts`
- `packages/runtime/tests/gateway/voice-output-synthesizer.test.ts`
- `packages/cli/src/config/global-config.test.ts`
- `packages/gateway-contracts/tests/voice-input-parts.test.ts`
- `packages/gateway-contracts/tests/voice-output-parts.test.ts`
- `packages/runtime/tests/gateway/gui-frame-parts.test.ts`
- `packages/gui/tests/composer.test.tsx`
- `packages/gui/tests/message-row.test.tsx`
- `packages/gui/tests/session-store.test.ts`
- `packages/sdk/tests/use-kiln-chat.test.ts`
- `packages/widget/tests/widget.test.ts`
- `packages/tui/tests/gateway-session.test.ts`
- `packages/native/tests/native-boundary.test.ts`
