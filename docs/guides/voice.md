# Voice

Voice has two configuration scopes:

- App voice belongs in `app.yaml` under the top-level `voice` key. It controls
  deployed app surfaces such as App Gateway, API, SDK, widget, web, recorder,
  and external channels.
- Operator voice belongs in `~/.kiln/config.yaml` under the top-level
  `operatorVoice` key. It controls the developer's local operator surfaces:
  `kiln gui`, `kiln tui`, and native operator shells.

Both scopes use the same `VoiceConfig` shape. The difference is ownership:
`voice` travels with a deployable app, while `operatorVoice` stays with the
operator machine and should reference local commands through environment
variables.

## Current Runtime Baseline

Implemented today:

- gateway speech-to-text for audio messages
- OpenAI and Deepgram STT adapter selection
- OpenAI and ElevenLabs TTS adapter selection
- local Whisper-compatible STT command adapter selection
- local Kokoro-compatible TTS command adapter selection
- governed assistant-output synthesis in the admitted-turn runtime pipeline
- synthesized audio artifact retention and `multimodal_routed` evidence
- recorder voice tracks through injected STT/TTS adapters
- app-level `voice.policy` parsing and validation
- REST and WebSocket assistant response `parts` transport
- shared browser voice-input part creation in `@kilnai/gateway-contracts`
- GUI and widget microphone and audio file controls that send canonical audio
  content parts
- GUI and TUI operator surfaces load `operatorVoice` from global config and
  transcribe audio before model transport
- GUI and widget playback controls for audio output parts
- TUI terminal projection for audio artifact references
- native surface capability advertisement for voice capture and playback
- Meta channel outbound voice delivery through signed HTTPS media URLs:
  WhatsApp uses Cloud API `audio.link`; Instagram and Messenger use Send API
  `audio` attachments.

## App YAML

Use `voice` when the app owns the provider policy.

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
        output:
          modes: [audio-response, transcript-only]
          failureMode: fail-closed
      instagram:
        enabled: true
        input:
          modes: [audio-part]
          failureMode: fail-open
        output:
          modes: [audio-response, transcript-only]
          failureMode: fail-closed
      messenger:
        enabled: true
        input:
          modes: [audio-part]
          failureMode: fail-open
        output:
          modes: [audio-response, transcript-only]
          failureMode: fail-closed
      gui:
        enabled: true
        input:
          modes: [microphone, file]
        output:
          modes: [audio-on-demand, transcript-only]
          failureMode: fail-closed
      widget:
        enabled: true
        input:
          modes: [microphone, file]
        output:
          modes: [audio-response, transcript-only]
      recorder:
        enabled: true
        output:
          modes: [artifact-only]
```

## Operator Voice

Use `operatorVoice` in `~/.kiln/config.yaml` when the developer machine owns
the provider policy for local GUI, TUI, or native operator use. This is the
right place for local Whisper and Kokoro because the executable paths,
installed models, and device choices are machine-local.

```yaml
version: "1"
operatorVoice:
  stt:
    provider: whisper-local
    model: base
    commandEnv: KILN_WHISPER_COMMAND
    modelPathEnv: KILN_WHISPER_MODEL_PATH
    device: auto
    timeoutMs: 120000
  tts:
    provider: kokoro-local
    model: kokoro-v1
    voice: af_bella
    commandEnv: KILN_KOKORO_COMMAND
    modelPathEnv: KILN_KOKORO_MODEL_PATH
    device: auto
    timeoutMs: 120000
    format: wav
  defaults:
    ttsProfile: english-default
  ttsProfiles:
    english-default:
      style: calm, concise technical assistant
      voice: af_bella
      language: en-us
      speed: 1
      speedRange: [0.95, 1.05]
      format: wav
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
        brief:
          delivery: Slightly quicker delivery for short confirmations.
          appliesWhen:
            - Short acknowledgements, status updates, and confirmations.
          speed: 1.03
        careful:
          delivery: Slower and more deliberate delivery for instructions.
          appliesWhen:
            - Step-by-step guidance, safety-sensitive instructions, or dense technical explanations.
          speed: 0.96
  policy:
    defaultInputFailureMode: fail-closed
    defaultOutputFailureMode: fail-closed
    artifacts:
      storeSourceAudio: true
      storeTranscripts: true
      storeSynthesizedAudio: true
      retentionMaxArtifacts: 50
    surfaces:
      gui:
        enabled: true
        input:
          modes: [microphone, file]
          failureMode: fail-closed
        output:
          modes: [audio-on-demand, transcript-only]
          failureMode: fail-closed
      tui:
        enabled: true
        output:
          modes: [audio-on-demand, transcript-only]
          failureMode: fail-closed
      native:
        enabled: true
        input:
          modes: [microphone, file]
          failureMode: fail-closed
        output:
          modes: [audio-on-demand, transcript-only]
          failureMode: fail-closed
```

At startup, `kiln gui` and `kiln tui` build the configured local adapters. If
an adapter cannot be initialized, Kiln prints an operator warning. When voice
input is then attempted with `fail-closed`, runtime raises a clear `STT_FAILED`
configuration error before any raw audio reaches the selected model provider.

Omit `voice.stt.language` or `operatorVoice.stt.language` to allow local
Whisper to auto-detect the spoken language. Set it only when a deployment must
constrain transcription to one language.

Use `audio-on-demand` for operator surfaces when text should remain the default
response and audio should be generated only after the operator clicks a voice
action. `audio-response` is reserved for channels where spoken output is part
of the delivery contract.

## Providers

STT providers:

| Provider | Adapter |
|---|---|
| `openai` | `OpenAISttAdapter` |
| `deepgram` | `DeepgramSttAdapter` |
| `whisper-local` | `WhisperLocalSttAdapter` |

TTS providers:

| Provider | Adapter |
|---|---|
| `openai` | `OpenAITtsAdapter` |
| `elevenlabs` | `ElevenLabsTtsAdapter` |
| `kokoro-local` | `KokoroLocalTtsAdapter` |

Runtime startup constructs the configured TTS adapter from `voice.tts`.
`elevenlabs` requires an explicit `voice` value because there is no safe
provider-neutral default voice id.

## Voice Profiles

`voice.tts` selects the TTS provider and adapter. `voice.ttsProfiles` defines
governed presentation profiles for that provider: style, voice id, language
hint, format, conservative speed, and named runtime intents. Agents reference
profile ids with `voiceProfile`; they do not invent provider ids, voice ids,
formats, or arbitrary speeds at runtime.

For local operator managed agents, keep voice identity in global config and
reference the governed `operatorVoice.ttsProfiles` catalog:

```yaml
managedAgents:
  enabled: true
  defaultVoiceProfile: english-default
  routes:
    - id: codex-reviewer
      kind: direct
      provider: codex-oauth
      model: gpt-5.6-luna
      voiceProfile: english-default
```

Route-level `voiceProfile` overrides `managedAgents.defaultVoiceProfile`.
Both must reference `operatorVoice.ttsProfiles`; managed agents do not carry
provider-specific voice settings inline.

```yaml
voice:
  tts:
    provider: kokoro-local
    model: kokoro-v1
    commandEnv: KILN_KOKORO_COMMAND
    format: wav
  defaults:
    ttsProfile: english-default
  ttsProfiles:
    english-default:
      style: calm, concise technical assistant
      voice: af_bella
      language: en-us
      speed: 1
      speedRange: [0.95, 1.05]
      format: wav
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
        brief:
          delivery: Slightly quicker delivery for short confirmations.
          appliesWhen:
            - Short acknowledgements, status updates, and confirmations.
          speed: 1.03
        careful:
          delivery: Slower and more deliberate delivery for instructions.
          appliesWhen:
            - Step-by-step guidance, safety-sensitive instructions, or dense technical explanations.
          speed: 0.96

teams:
  assistant:
    agents:
      worker:
        voiceProfile: english-default
```

Runtime resolves the profile during synthesis. A requested output intent is a
one-turn overlay on the selected profile; after that response, the next turn
returns to the profile default unless another admitted intent is supplied. The
supported intent ids are `neutral`, `calm`, `brief`, and `careful`. Each intent
must declare `delivery` and `appliesWhen` so the intent describes a real
speaking condition instead of becoming a free-form provider parameter. If an
unknown intent is requested at runtime, runtime ignores it and uses the base
profile.

When no admitted intent is supplied, runtime derives one from the final
assistant response after egress and grounding policy. Selection is conservative
and profile-bound:

- explicit admitted intent wins when the active profile declares it
- `calm` is used for error, failure, escalation, or support-friction language
- `careful` is used for procedural, code-like, or dense instruction responses
- `brief` is used for short acknowledgements and confirmations
- `neutral` is used when no more specific configured intent applies

Runtime never selects an intent that the active profile does not declare, and
provider adapters still receive only concrete synthesis options.

Keep profile speed ranges narrow. For conversational assistants, use
`[0.95, 1.05]` unless product testing proves a wider range improves
comprehension. This keeps voice output natural and avoids unstable character
shifts.

## Local Providers

Local providers are runtime adapters over an explicit local command protocol.
Kiln does not download models, install Python packages, start sidecars, or fall
back to cloud providers automatically.

```yaml
voice:
  stt:
    provider: whisper-local
    model: base
    commandEnv: KILN_WHISPER_COMMAND
    modelPathEnv: KILN_WHISPER_MODEL_PATH
    device: auto
    timeoutMs: 120000
  tts:
    provider: kokoro-local
    model: kokoro-v1
    voice: af_bella
    commandEnv: KILN_KOKORO_COMMAND
    modelPathEnv: KILN_KOKORO_MODEL_PATH
    device: auto
    timeoutMs: 120000
    format: wav
```

Use `command` for a committed app-specific executable path only when that path
is portable for the deployment. Prefer `commandEnv` for operator machines. The
optional `modelPath` and `modelPathEnv` values are passed to the command; Kiln
does not validate or create model files.

Omit `language` when the local STT engine should auto-detect the spoken
language. Set `language` only when the surface intentionally constrains
transcription to one language.

`command` and `commandEnv` resolve the executable. Put extra command arguments
in `args`; do not encode a shell command string with spaces and flags into
`commandEnv`.

The command receives one JSON object on stdin and must write one JSON object to
stdout.

STT request shape:

```json
{
  "operation": "transcribe",
  "provider": "whisper-local",
  "model": "small",
  "modelPath": "C:/models/whisper/small",
  "device": "auto",
  "language": "es",
  "mimeType": "audio/wav",
  "audioBase64": "..."
}
```

STT response shape:

```json
{
  "text": "hola mundo",
  "confidence": 0.9,
  "durationMs": 1000
}
```

TTS request shape:

```json
{
  "operation": "synthesize",
  "provider": "kokoro-local",
  "model": "kokoro-v1",
  "modelPath": "C:/models/kokoro",
  "device": "auto",
  "text": "hola mundo",
  "voice": "af_bella",
  "speed": 1,
  "format": "wav"
}
```

TTS response shape:

```json
{
  "audioBase64": "...",
  "mimeType": "audio/wav",
  "durationMs": 700
}
```

Malformed output, non-zero exits, start failures, and timeouts fail closed as
`STT_FAILED` or `TTS_FAILED` runtime errors. Missing local commands fail at
adapter construction as `CONFIG_MISSING_ENV`.

## Voice Tuning Guidance

Use conservative TTS defaults unless a product experience explicitly requires a
strong character voice. The recommended local baseline is:

- `voice: af_bella`
- `speed: 1.0`
- `format: wav`
- short assistant responses for spoken output
- natural punctuation, with fewer dense code-like tokens in synthesized text

Avoid trying to make local TTS sound too human by overusing emotional prose,
dramatic punctuation, very long paragraphs, or frequent voice changes. These
patterns make small local models feel less natural. Prefer a stable voice per
assistant identity and use text content to carry nuance.

For English-first assistants, `af_bella` is the recommended local default:
it has a strong official quality grade and passed local round-trip checks.
`bf_emma` remains a good British-English character option when that voice fit
matters more than the default American-English assistant profile.

For Spanish-first assistants, test language-matched voices before settling on a
default. In the local Kokoro model, `ef_dora`, `em_alex`, `pf_dora`, and
`pm_alex` produced cleaner Spanish round-trip checks than English-accented
voices.

Use `voice.ttsProfiles` when the app needs named per-agent voices or controlled
one-turn delivery intents. Keep the provider in `voice.tts`; profiles are
governed presentation overlays for the configured provider. The `style` field
describes the stable voice identity. Runtime intents should only make small,
temporary delivery changes that match the response context, such as calming an
error explanation or making a short confirmation slightly quicker.

## Surface Policy

Supported surfaces:

`api`, `web`, `whatsapp`, `messenger`, `instagram`, `gui`, `native`, `tui`,
`cli`, `sdk`, `widget`, `recorder`.

Supported input modes:

- `audio-part`
- `microphone`
- `file`

Supported output modes:

- `audio-response`
- `transcript-only`
- `artifact-only`
- `audio-on-demand`

Use `fail-open` only when the degraded path is explicit and observable. Use
`fail-closed` for output by default so Kiln does not imply that spoken output
was produced when synthesis failed.

## Surface Capture Projection

Browser-capable surfaces use the shared voice-input helper in
`@kilnai/gateway-contracts/voice-input-parts` to convert recorded audio blobs
and selected `audio/*` files into canonical Kiln content parts:

- GUI and widget microphone controls record with `MediaRecorder`, select a
  supported audio MIME type, and send `{ type: "audio", mimeType, data }` parts.
- GUI and widget audio file controls read selected `audio/*` files and send the
  same canonical `{ type: "audio", mimeType, data }` parts.
- GUI WebSocket frames can carry `parts` on outbound `message` frames; runtime
  resolves those parts before entering the admitted-turn pipeline.
- Widget WebSocket frames can carry `parts` on outbound `message` frames; the
  existing gateway STT pipeline owns transcription and failure policy.
- SDK users can call `send(ContentPart[])` directly for audio input; they do
  not need a separate voice API.

Surfaces do not transcribe locally and do not invent placeholder text. If STT
fails, the runtime applies the app-level input failure mode and records
evidence.

## Surface Playback Projection

Runtime emits synthesized assistant audio as response `parts`. Operator
surfaces must project those parts through the shared helper in
`@kilnai/gateway-contracts`:

- GUI and widget render compact playback actions for inline data URLs or
  remote audio URLs, and render artifact links when `artifactUri` is present.
- TUI renders a terminal line with the audio label, MIME type, and artifact or
  URL reference.
- SDK REST preserves response `parts` on assistant messages so application
  UIs can choose their own presentation without reinterpreting runtime policy.
- Native advertises `voice-input-capture` and `voice-output-playback` as
  surface capabilities; app-level `voice.policy` remains the authority for
  provider choice, failure modes, and artifact retention.
- WhatsApp, Instagram, and Messenger publish synthesized audio artifacts
  through signed gateway media URLs when the channel binding includes
  `publicMediaBaseUrlEnv` and `publicMediaSigningSecretEnv`. WhatsApp sends the
  resulting URL through the Cloud API `audio.link` payload; Instagram and
  Messenger send it as an `audio` attachment URL.

The projection helper intentionally filters malformed audio-like parts. A
surface should show nothing for invalid audio metadata rather than inventing a
fallback source.

## Validation

The app loader validates:

- STT and TTS provider ids
- local provider command arguments and timeouts
- TTS profile style
- TTS intent ids, delivery descriptions, applies-when rules, and speed ranges
- surface ids
- input and output modes
- failure modes
- artifact retention limits

Focused tests:

```bash
bun run --cwd packages/cli test src/config/global-config.test.ts
bun run --cwd packages/core test tests/agents/infrastructure/openai-tts.test.ts tests/agents/infrastructure/elevenlabs-tts.test.ts
bun run --cwd packages/core test tests/engine/domain/speech-config.test.ts tests/engine/loader/app-loader.test.ts
bun run --cwd packages/runtime test tests/gateway/stt-factory.test.ts tests/gateway/tts-factory.test.ts tests/gateway/local-voice-adapters.test.ts tests/gateway/message-pipeline.test.ts
bun run --cwd packages/gateway-contracts test tests/voice-input-parts.test.ts
bun run --cwd packages/gateway-contracts test tests/voice-output-parts.test.ts
bun run --cwd packages/runtime test tests/gateway/gui-frame-parts.test.ts
bun run --cwd packages/gui test:run tests/composer.test.tsx tests/message-row.test.tsx tests/session-store.test.ts
bun run --cwd packages/widget test tests/widget.test.ts tests/ws-client.test.ts
bun run --cwd packages/tui test tests/gateway-session.test.ts
bun run --cwd packages/native test tests/native-boundary.test.ts
```

## Architecture

Voice architecture, boundaries, evidence requirements, and invariants are
defined in [Voice Capability](../architecture/voice-capability.md).
