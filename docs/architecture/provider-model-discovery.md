# Provider Model Discovery

## Purpose

Provider model discovery is the runtime-owned contract that tells operator
surfaces which providers can execute, which concrete model IDs are selectable,
and why a provider is unavailable.

Discovery is not a fallback mechanism. Kiln must not invent static models or
silently choose a provider when runtime discovery cannot prove availability.

## Discovery Result

GUI and TUI consume the same structured discovery result:

- `provider`
- `available`
- `models`
- `status`
- `reason`
- `authState`
- `lastCheckedAt`

Common statuses include:

- `available`
- `missing_auth`
- `auth_expired`
- `cli_missing`
- `endpoint_timeout`
- `endpoint_error`
- `empty_model_list`
- `daemon_unreachable`
- `model_selection_not_required`

The same discovery result gates execution and drives operator diagnostics.
Surfaces may abbreviate the human-facing reason, but they must not derive
availability from a different source.

## Provider Classes

Wrapper providers and direct providers use provider-specific discovery because
their failure modes differ.

Wrapper providers:

- `claude` is model-less when the harness is available
- `codex` discovers local Codex CLI models from the local Codex model surface
- `opencode` discovers local OpenCode CLI models from the OpenCode command
  surface

Subscription-auth providers:

- `codex-oauth` discovers models from the OAuth-backed Codex model endpoint
- `opencode-go` and `opencode-zen` discover models from the authenticated
  OpenCode subscription tier

Direct API providers:

- `openai`, `anthropic`, `deepseek`, and `openrouter` discover models through
  provider model endpoints and filter to usable message/chat models where the
  response supports that distinction
- `ollama` discovers local models through the local daemon and distinguishes a
  daemon connection failure from an empty installed-model list

## Selection Rules

- no static model fallback lists
- no default-to-first-provider behavior
- no hidden default-to-first-model behavior
- unavailable providers are non-selectable for execution
- model-less providers are explicit and do not use fake model IDs
- prompt execution revalidates the active provider/model before admission
- provider switch errors and prompt execution errors use the same wording for
  the same readiness failure

If a provider has selectable models, execution requires a concrete selected
model ID. If no selected model exists, the canonical error wording is:

```text
Provider '<provider>' requires a selected model.
```

## Operator UX

Provider pickers show concise unavailable reasons while preserving structured
diagnostics in the runtime result. Examples:

- missing API keys or credentials become "Auth is missing."
- local daemon or connection failures become "Local service is unreachable."
- empty catalogs become "No models found."
- failed model endpoints become "Model endpoint failed."

GUI and TUI expose provider refresh without restarting the process. Refresh
re-runs runtime discovery, updates the selectable model catalog, and leaves the
current operator session alive.

## Turn Records

Live prompt admission records provider validation provider-by-provider in the
runtime turn record. This preserves the evidence used to admit or reject a turn
and makes post-hoc diagnosis possible without replaying discovery.

## Invariants

- discovery is runtime-owned
- execution uses the same provider availability truth shown to the operator
- diagnostics are provider-specific and fail closed
- model IDs passed to execution are concrete provider model IDs
- local providers do not imply cloud auth or remote model availability
- unavailable reasons are actionable, not generic placeholders
