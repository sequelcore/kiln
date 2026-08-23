# App YAML Reference

This is the operator reference for the canonical `app.yaml` configuration
surface.

`app.yaml` remains an important implementation surface, but it is not the
architectural source of truth for Kiln. The source of truth is the modular
architecture under [`docs/architecture/`](../architecture/README.md).

It is a first-class deployable app declaration. When bound by `gateway.yaml`, an
`app.yaml` is instantiated by the App Gateway and participates in the same
session, memory, safety, tool, event, and cost control plane as other runtime
surfaces. GUI, CLI, and TUI operate that runtime; they do not replace the app
declaration with parallel surface-specific behavior.

If the configuration surface and the architecture diverge, the architecture wins
and the configuration must eventually be refactored to match it.

## Schema And Admission

Core owns one strict TypeBox structural schema and derives the admitted raw
TypeScript shape, editor JSON Schema, and field descriptors from it. The
committed artifacts are
[`app-config-v1.json`](../../packages/core/schemas/app-config-v1.json) and
[`app-config-descriptors-v1.json`](../../packages/core/schemas/app-config-descriptors-v1.json).
Run `bun run --cwd packages/core config:schema:generate` after changing the
schema owner.

`parseAppYaml` is the only YAML reader. It parses app, provider-adapter, and
billing fields from the same admitted document before named semantic and graph
validation. Unknown root or nested fields fail with the source path, exact
property path, and running schema identity. The former runtime-mode YAML reader
and the test-only App-to-Orchestrator preset bridge have been deleted. Agent
`count`, team `workflow`, and team `qualityGates` are not app configuration;
the strict schema rejects them. App `channels`, `memory`, `router.rules`,
`eval`, and `toolSelection` are also retired: Gateway app bindings own channel
topology, runtime owns its memory stores and authority contracts, evaluation is
an explicit Eval API workflow, and App routing retains only the consumed
`router.fallback` team selection.

Secret material is not valid app intent. `provider.apiKeyEnv` stores an
environment-variable name. Every `billing.headers` value must be a `$NAME`
environment reference and is resolved only in memory. All app fields currently
activate at `restart-required` through the App Gateway supervisor.

General app authoring remains explicit. The supported cron add/remove commands
are the only shared writer: Core validates the existing document, mutates only
the `triggers` YAML AST, validates the result, and preserves unrelated comments
and presentation instead of serializing the whole app as a generic object.

## What This File Is For

Use `app.yaml` documentation when you need to understand the currently supported
runtime configuration surface:

- fallback routing and execution declarations
- voice configuration
- safety and tool configuration
- trigger wiring
- provider and runtime model settings

Do not use `app.yaml` as the primary way to infer what Kiln fundamentally is.

## Current Status

The configuration model still reflects earlier generations of Kiln in places:

- team-centric execution structure
- capability lists
- app-first configuration language

Those concepts may still exist in the running product, but they should be read
as implementation-era structures, not as the final architectural vocabulary.
Slice 9 is continuing with a property-by-property reachability decision: a
declared field is retained only when a runtime consumer is demonstrated or
completed in the same bounded change.

## Canonical Crosswalk

When reading configuration, reinterpret it through the current architecture:

- `router.fallback` maps to the App Gateway's fallback team selection
- tool and permission declarations map to safety and tool-execution concerns
- voice blocks map to the shared voice capability, multimodal transform, and
  artifact evidence model
- model routing maps to control and adaptation policy, not product identity

Workflow phases and verification gates belong to their execution and project
configuration owners. They are not inferred from an app team.
Channel exposure belongs to each `gateway.yaml` app binding. Memory storage and
model-facing memory authority remain under their runtime and permission owners;
`app.yaml` does not configure either concern.

Relevant architecture docs:

- [Identity](../architecture/core/identity.md)
- [Subsystems](../architecture/core/subsystems.md)
- [Flows](../architecture/core/flows.md)
- [Safety](../architecture/safety/safety.md)
- [Memory](../architecture/context/memory.md)
- [Context Governance](../architecture/context/context-governance.md)
- [Tool Execution](../architecture/tooling/tool-execution.md)
- [Runtime Surfaces](../architecture/surfaces/runtime-surfaces.md)
- [Voice Capability](../architecture/providers/voice-capability.md)

## Canonical MCP References

`app.yaml` does not define MCP transports or credentials. It references
canonical global/project server identities:

```yaml
mcp:
  servers: [support-tools]
```

App Gateway resolves these ids through Kiln configuration, discovers admitted
capabilities, applies app/agent/tenant allowlists, and fails startup when a
reference is missing or discovery fails. See [Canonical MCP](../guides/channels/mcp.md).

## Voice Provider Fields

The current parser accepts app-level voice providers through `voice.stt` and
`voice.tts`.

STT providers:

- `openai`
- `deepgram`
- `whisper-local`

TTS providers:

- `openai`
- `elevenlabs`
- `kokoro-local`

Cloud providers use `apiKeyEnv`. Local providers use `command` or
`commandEnv`, with optional `args`, `modelPath` or `modelPathEnv`, `device`,
and `timeoutMs`. STT also accepts `language`; TTS also accepts `voice` and
`format`.

Voice profiles are configured under `voice.ttsProfiles`. A profile must set
`style` and may set `voice`, `language`, `speed`, `speedRange`, `format`, and
named `intents`. Supported intent ids are `neutral`, `calm`, `brief`, and
`careful`; each configured intent must include `delivery` and `appliesWhen`.
`voice.defaults.ttsProfile` selects the app default, and agents may reference a
profile with `voiceProfile`. Runtime applies a requested intent only for the
current synthesis call and validates it against the named profile.

If no valid `voiceOutputIntent` is admitted for a turn, runtime can derive one
from the final assistant text and runtime escalation evidence. The derived
intent is still limited to the active profile's declared intents, so app YAML
remains the authority for which delivery shifts are allowed.

Local operator surfaces use global config instead of app YAML. Configure
`~/.kiln/config.yaml` top-level `operatorVoice` for `kiln gui`, `kiln tui`, and
native operator shells when the provider policy belongs to the developer
machine rather than a deployable app.

Canonical examples:

- [cloud voice capability](../examples/configs/voice-capability.yaml)
- [local voice capability](../examples/configs/local-voice-capability.yaml)
- [local operator voice](../examples/configs/local-operator-voice.yaml)

## Usage Guidance

If you are:

- designing architecture, start in `docs/architecture/`
- justifying a concept, start in `docs/research/`
- sequencing change, start in `docs/roadmap/`
- checking what the current parser/runtime accepts, use this config reference layer

## Transitional Note

The old exhaustive schema-first narrative has been intentionally removed from
this page because it preserved the outdated product frame too strongly.

If a detailed field-by-field reference is still needed during refactor, it
should be rebuilt later in a way that:

- matches the canonical taxonomy
- clearly marks implementation residue
- avoids reintroducing the old identity through documentation structure
