# 01 - Provider Credential Pool

## Goal

Kiln currently holds exactly one credential per provider. This blocks scaling
beyond a single subscription's rate limit and has no recovery path when an
individual credential hits a 429 or 402 mid-session. The credential pool
introduces a provider-agnostic layer that manages multiple credentials per
provider, rotates them, tracks per-credential cooldowns, and presents a single
adapter surface to upstream callers. It applies equally to subscription-auth
providers (`codex-oauth`, `opencode-go`, `opencode-zen`), direct API-key
providers (`anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`,
`lmstudio`), and
harness-wrapped providers (`claude-code`, `codex`, `opencode`).

## Scope

| Category | Example providers | Credential type | Pool behavior | Notes |
|----------|-------------------|-----------------|---------------|-------|
| Subscription-auth | `codex-oauth`, `opencode-go`, `opencode-zen` | Stored auth JSON (token or API key) | Rotate on 429/402; cooldown to server-supplied `resetAt` or 1 h default | Multiple accounts = multiple JSON files under `~/.kiln/auth/<provider>/` |
| Direct API-key | `anthropic`, `openai`, `deepseek`, `openrouter` | API key string | Rotate on 429/402; per-key cooldown tracking | Env-var fallback still valid for single-key mode |
| Self-hosted / local | `ollama`, `lmstudio` | Endpoint URL (no key) | Rotate across endpoint replicas; 429 and connection-refused both trigger rotation | Multiple replicas = multiple entries |
| Harness wrappers | `claude-code`, `codex`, `opencode` | Wrapper home directory path | Rotate across wrapper home directories; wrapper binary manages its own token refresh inside each home | Pool owns home selection, not token contents |

## Non-Goals

- Not a new auth flow. Existing `OpenCodeAuth`, `CodexOAuthAuth`, and
  API-key env patterns are reused as credential sources — the pool layer sits
  above them, not inside them.
- Not a load balancer. The pool selects credentials, not inference regions,
  model replicas, or provider-side routing.
- Not a billing system. Dollar-limit enforcement remains on the provider side.
  The pool only tracks Kiln-observable signals: 429, 402, and success.
- Does not unify harness wrapper auth with direct provider auth at the OS
  level. It unifies them at the Kiln runtime adapter layer only.
- No new provider protocol. Every provider keeps its existing adapter;
  the pool wraps those adapters without touching their protocol logic.

## Architecture

### Reference implementation

`hermes-agent` already has the closest working precedent:

- `C:/Proyectos/Sequel/hermes-agent/agent/credential_pool.py` for selection
  strategies, cooldown expiry, per-entry status, and rotation after exhaustion.
- `C:/Proyectos/Sequel/hermes-agent/tests/agent/test_credential_pool.py` for
  behavior tests that cover 402/429 cooldowns, reset timestamps,
  `round_robin`, `random`, `least_used`, env-seeded credentials, and
  concurrency.
- `C:/Proyectos/Sequel/hermes-agent/tools/mcp_oauth_manager.py` for the
  `st_mtime_ns` disk-change invalidation pattern.

Use Hermes as a behavioral blueprint, not as code to copy. Hermes is pragmatic
and proven, but its pool owns persistence and provider-specific refresh
branches. Kiln must keep those responsibilities outside the core domain.

### Package location

New directory: `packages/core/src/agents/credential-pool/`

Following Clean Architecture: domain types and selection policy live in
`@kilnai/core` with no IO. File-system credential loading and file-watcher
logic live in `@kilnai/runtime`. CLI commands that read/write credentials
stay in `@kilnai/cli`.

Runtime support lives under `packages/runtime/src/agents/credential-pool/`:

- credential source readers and writers
- single-file-to-directory migrations
- `st_mtime_ns`-based change detection
- provider-specific error-to-outcome mappers where they depend on transport
  shape

CLI support stays in `packages/cli/src/commands/auth.ts` and should call
runtime services instead of reading arbitrary auth files directly.

### Domain entities

- `Credential<TAuth>` — an auth value plus domain metadata: id, label,
  provider id, source, priority, optional tier tag, request counters,
  last-success, last-exhausted, cooldown-until, and soft-lease count.
- `CredentialPool<TAuth>` — a named, typed collection of `Credential<TAuth>`
  instances. Exposes `acquire(): Lease<TAuth>` and
  `report(lease: Lease<TAuth>, outcome: CredentialOutcome): void`.
- `SelectionStrategy` — policy enum: `fill-first` (exhaust one credential
  before moving), `round-robin`, `random`, `least-used`. Applies within
  the set of credentials not currently in cooldown.
- `CooldownPolicy` — defines default cooldown duration (1 h) and the rule
  for accepting a server-supplied `resetAt` override from the error response.
- `CredentialOutcome` — typed discriminated union: `ok`, `rate-limited`
  (with optional `resetAt`), `quota-exceeded`, `auth-failed`,
  `connection-failed`, `unknown-error`.
- `CredentialPoolSnapshot` — immutable read model for CLI and observability.
  It contains metadata and health only; it never exposes secret values.
- `CredentialPoolStatePort` — optional persistence callback interface supplied
  by runtime. Core emits state transitions through this port; core never reads
  files or imports runtime.

### Core contract

```
acquire() -> Lease<TAuth>    // synchronous selection from current in-memory state
report(lease, outcome)       // updates cooldown state; never throws
snapshot() -> CredentialPoolSnapshot
```

The pool never leaks provider-specific error types. Every error that reaches
`report()` must first be mapped to `CredentialOutcome` by the adapter layer.

`acquire()` does not do IO and does not block on file reloads. If no credential
is usable, it throws `ALL_CREDENTIALS_EXHAUSTED` with the last exhaustion cause
attached. Runtime owns reloading before or around acquisition when files are
stale.

### Adapter wrapper

`PooledProviderAdapter<TAuth>` wraps any existing `ProviderAdapter` with
pool-aware acquire/report/retry. It takes:

- a `CredentialPool<TAuth>`
- a factory `(auth: TAuth) => ProviderAdapter`
- an `ErrorOutcomeMapper`
- retry options with an explicit maximum attempts cap

On `rate-limited`, `quota-exceeded`, and provider-specific
`connection-failed` outcomes, it reports the lease and retries with the next
available credential. Auth errors and unknown errors are reported and then
propagated immediately. If all credentials are exhausted, it throws
`ALL_CREDENTIALS_EXHAUSTED`; the original provider error is attached as
`cause` but is not surfaced raw.

Streaming retries discard buffered output and rerun the full turn. The wrapper
must not yield partial text from a failed stream.

Existing provider adapters must not contain credential selection, cooldown, or
rotation logic. They may expose provider-specific errors, but retry decisions
belong to the pool wrapper.

### Cross-process coordination

File-system watcher (in `@kilnai/runtime`) monitors `~/.kiln/auth/**/*.json`
for mtime changes. On change, the pool for the affected provider invalidates
its cached credential entries and reloads from disk. This ensures that
`kiln auth <provider> link` in one shell propagates to running workers in
another without restart. Pattern derived from `hermes-agent`
`mcp_oauth_manager.py` mtime-based reload.

Use `st_mtime_ns` where the platform exposes nanosecond precision. Fall back
to millisecond precision only behind a small runtime helper. The watcher must
not live in `@kilnai/core`.

### Persistence model

Credential file contents are runtime DTOs, not domain entities. Runtime maps
DTOs into `Credential<TAuth>` and maps snapshots back to health/status fields
when persistence is required. Secret-bearing DTOs and health-only snapshots are
separate types to avoid accidental leakage in CLI or observability output.

There is no global credential store in this roadmap. The source of truth is
the provider directory under `~/.kiln/auth/<provider>/`, plus env-var fallback
for single-key direct providers. In-process telemetry resets on restart unless
explicitly written as per-entry health metadata by runtime.

## Slice Plan

### Slice 0 — Current-state scout and deletion map

Before code, map every current single-credential entry point and decide whether
it is replaced, migrated, or left as env-only fallback. Expected files include:

- `packages/core/src/agents/infrastructure/opencode-auth.ts`
- `packages/core/src/agents/infrastructure/codex-oauth-auth.ts`
- `packages/core/src/agents/infrastructure/openai-compat.ts`
- `packages/cli/src/wrapper/direct-provider-adapter-factory.ts`
- `packages/cli/src/commands/auth.ts`
- `packages/runtime/src/gateway/provider-auth.ts`
- `packages/runtime/src/gateway/gateway-server.ts`

Acceptance: `docs/plan.md` identifies exact files, tests, deletion points,
and package ownership. It must explicitly call out any old single-file path
that will be deleted after migration. No implementation starts until this map
exists.

### Slice 1 — Core domain types and policies — Completed 2026-05-02

Created `packages/core/src/agents/credential-pool/` with:

- `credential.ts` — `Credential<TAuth>`, `Lease<TAuth>`, `CredentialOutcome`
- `pool.ts` — `CredentialPool<TAuth>` with `acquire`, `report`, and `snapshot`
- `strategies.ts` — `SelectionStrategy` enum and selection logic
- `cooldown.ts` — `CooldownPolicy` with default and server-supplied `resetAt`
- `outcome.ts` — `ALL_CREDENTIALS_EXHAUSTED` error type
- `state-port.ts` — optional `CredentialPoolStatePort` for runtime-provided
  persistence callbacks

No IO. Provider-agnostic. No imports from provider infrastructure. This slice
ports Hermes behavior into pure TypeScript domain code while removing Hermes'
persistence and provider-refresh branches from the domain.

Acceptance status:

- `fill-first`, `round-robin`, `random`, and `least-used` work against
  in-memory credentials.
- 429 and 402 cooldown default to 1 h.
- server-supplied `resetAt` overrides the default cooldown.
- expired cooldowns are cleared on acquisition.
- soft leases are counted and released through `report()`.
- `snapshot()` returns health without secret values.
- `acquire()` throws `ALL_CREDENTIALS_EXHAUSTED` when every credential is in
  cooldown.
- `bun run typecheck` and targeted unit tests pass.

Verification completed:

- `cmd.exe /c bun x vitest run packages/core/tests/agents/credential-pool.test.ts`
  — 31 tests passed.
- `cmd.exe /c bun run typecheck` — passed.
- `cmd.exe /c bun run --filter @kilnai/core test` — 226 files and 2899 tests
  passed.

Notes for Slice 2:

- `connection-failed` is a retryable outcome and currently uses the default
  cooldown. Slice 2 error mappers may refine this per provider.
- `resetAt` is not capped unless `maxCooldownMs` is explicitly configured.

### Slice 2 — Adapter wrapper — Completed 2026-05-02

Added `PooledProviderAdapter<TAuth, TAdapter extends ProviderAdapter>` in
`packages/core/src/agents/credential-pool/pooled-adapter.ts`.

The wrapper takes a `CredentialPool<TAuth>`, a factory `(auth: TAuth) => TAdapter`,
an `ErrorOutcomeMapper`, and an optional maximum-attempt cap. It implements
`createMessage` and `streamMessage` with the acquire → call → report → retry
loop. Retry continues only for retryable `CredentialOutcome` values:
`rate-limited`, `quota-exceeded`, and `connection-failed`. Auth errors and
unknown errors are reported and then propagated immediately.

Streaming retries buffer one attempt at a time. Failed attempts discard buffered
events and rerun the full stream; callers receive only the successful attempt's
events.

Acceptance status:

- unit tests cover single-credential exhaustion, two-credential rotation,
  auth failure propagation, unknown error propagation, and all-credentials
  exhausted.
- streaming tests prove a mid-stream rate-limit reruns the full turn and does
  not surface partial text.
- no provider adapter now owns pool selection, cooldown, or rotation behavior.
- provider-internal 429/402 retry bypass remains an integration requirement for
  the later provider wiring slices; there are no pool-enabled provider paths in
  this core wrapper slice.
- `PooledProviderAdapter`, `ErrorOutcomeMapper`, and
  `PooledProviderAdapterConfig` are exported from the credential-pool module and
  the core agents index.

Verification completed:

- `cmd.exe /c bun x vitest run packages/core/tests/agents/credential-pool.test.ts`
  — 36 tests passed.
- `cmd.exe /c bun run --filter @kilnai/core test` — 226 files and 2904 tests
  passed.
- `cmd.exe /c bun run typecheck` — passed.

### Slice 3 — Runtime credential file service

Add `packages/runtime/src/agents/credential-pool/` with:

- `credential-file-store.ts` — provider directory reader/writer for
  `~/.kiln/auth/<provider>/*.json`
- `credential-migrator.ts` — one-way migration from old single files into
  directory form
- `credential-pool-factory.ts` — builds core pools from runtime DTOs
- `credential-health-store.ts` — persists only non-secret health metadata
  when needed by CLI status

The runtime store owns all filesystem details. Core receives already-parsed
auth values and emits state transitions through `CredentialPoolStatePort`.

Acceptance:

- malformed credential files fail fast with provider/name context.
- secret-bearing DTOs are not returned by status/snapshot methods.
- migration writes the directory entry, verifies it can be read, then deletes
  the old file.
- old single-file and new directory forms cannot coexist after migration.
- targeted runtime tests pass.

### Slice 4 — OpenCode integration

Wire `opencode-go` and `opencode-zen` through the pool.

Auth directory: `~/.kiln/auth/opencode/`. Each file is a `{name}.json` with
the same shape as the current single `~/.kiln/auth/opencode.json`. The first
`link` command targeting a directory-less setup migrates the existing single
file into `~/.kiln/auth/opencode/default.json` and removes the top-level
file. No compatibility shim — after migration only the directory form exists.

`OpenCodeAuth` must stop being the long-term owner of pool storage. It may be
used as a migration reader for the existing single-file shape, but new writes
go through the runtime credential file service. After migration is complete,
dead single-file write paths are deleted.

Acceptance: `kiln auth opencode link` with a second key creates a second
entry; `kiln auth opencode status` lists both entries with per-entry health.
`OpenCodeAdapter` via `PooledProviderAdapter` rotates to the second credential
on a simulated 429. Pool-entry count is visible in gateway observability.

### Slice 5 — Codex OAuth integration

Wire `codex-oauth` through the pool.

Auth directory: `~/.kiln/auth/codex-oauth/`. Same directory-of-files pattern.
Migration: existing `~/.kiln/auth/codex-oauth.json` → `~/.kiln/auth/codex-oauth/default.json`.

`CodexOAuthAuth` remains responsible for token refresh for one credential
value, not for selecting among credentials. Runtime constructs one auth
instance per leased token file. Any refreshed token is written back to that
same credential entry, not to a shared singleton path.

Acceptance: two Codex OAuth accounts rotate correctly; `kiln auth codex-oauth
status` shows per-entry health.

### Slice 6 — Direct API-key and local endpoint providers

Wire `anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`, and
`lmstudio` through the pool.

Auth directory per provider: `~/.kiln/auth/<provider>/`. Each file is a
`{name}.json` containing the API key (and base URL for `ollama` and
`lmstudio`). Env-var fallback (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
remains valid and is treated as a synthetic single-entry pool with the name
`env`.

Roadmap note (2026-04-25): `lmstudio` should be treated as a distinct local
provider, not folded into `ollama`. It serves OpenAI-compatible endpoints at
`http://localhost:1234/v1` by default, commonly requires no API key, and
matches the current operator setup where Claude Code, Codex, and OpenCode can
all target the same LM Studio server directly. In Kiln, first-class `lmstudio`
support means:

- a dedicated provider ID in provider selection, routing, and GUI metadata
- endpoint-based pool entries like `ollama`, with default base URL
  `http://localhost:1234/v1`
- no forced API key requirement for single-machine local use
- separation from harness projection work: Claude Code reaches LM Studio via
  Anthropic-compatible `/v1/messages`, while Codex and OpenCode use
  OpenAI-compatible endpoints; Kiln's direct `lmstudio` provider concerns only
  Kiln's own provider-adapter/runtime path

Operational note (2026-04-27): local LM Studio support needs explicit model
profiles, not just a base URL. A real Windows operator setup used:

- `qwen/qwen3.5-9b` (`Q4_K_M`) as the fast/base local worker
- `qwen/qwen3-coder-30b` (`Q4_K_M`) as the main local coding worker
- `mistralai/devstral-small-2-2512` (`Q4_K_M`) as the alternate agentic SWE
  worker
- `zai-org/glm-4.7-flash` (`Q4_K_M`) as a secondary coding/reasoning option

Kiln should model these as role-based local worker profiles (`fast-local`,
`coding-local`, `coding-alt-local`) rather than a single `lmstudio.model`
string. Profile metadata should include model ID, endpoint compatibility
(`openai-chat`, `openai-responses`, `anthropic-messages`), context length,
tool-call support, vision support, intended role, and load policy.

Hardware-aware load policy matters. On an 8 GB VRAM / 32 GB RAM Windows
machine, the reliable operating pattern was load one model, use it, then
unload it before loading another heavy model. The base 9B model was usable at
`40960` context for Claude Code prompts, while `16384` was too small for a
normal Claude Code startup context. Kiln should not assume several local
models can remain resident simultaneously. It should support:

- manual mode: operator loads the model and Kiln only verifies availability
- assisted mode: Kiln emits the exact `lms load` / `lms unload` commands
- future managed mode: Kiln uses LM Studio load/unload APIs when that contract
  is stable enough for production use

Key point: env-var single-key mode must not require migration. The pool loader
checks for a directory, then for env-var; it never requires the user to
convert a working env-var setup.

Acceptance: multi-key `anthropic` pool rotates on 429; env-var single-key
path is not broken; `bun run test` passes.

### Slice 7 — Harness provider passthrough

For `claude-code`, `codex`, and `opencode` harness wrappers, the pool
selects which wrapper home directory the subprocess is pointed at. Each pool
entry is a home directory path, not a credential value.

Home directories under each wrapper's Kiln management:
- Claude Code: entries in `~/.kiln/auth/claude-code/` are paths to Claude
  home directories; `CLAUDE_HOME` or equivalent env is set per subprocess.
- Codex: entries point at Codex home directories; `CODEX_HOME` env is set.
- OpenCode: entries point at OpenCode config directories;
  `OPENCODE_CONFIG_DIR` env is set.

The wrapper binary manages its own token refresh inside its assigned home.
The pool does not intercept or block wrapper-side refreshes. On 429 from a
wrapper subprocess, the pool rotates to the next home directory.

Acceptance: two Codex home directories rotate on simulated 429 subprocess
exit; wrapper subprocess env is set correctly per entry.

### Slice 8 — Cross-process reload

Add `CredentialWatcher` in `packages/runtime/src/agents/credential-pool/`.
Watches `~/.kiln/auth/**/*.json` with `st_mtime_ns`-based polling, matching
the Hermes MCP OAuth manager pattern. Use a 500 ms interval when active and a
longer interval when idle. On mtime change, invalidates the pool for the
affected provider and reloads credentials from disk.

The watcher is started by the gateway on startup and stopped on shutdown.
Worker processes that do not run a gateway use a runtime-side one-shot reload
before acquisition when the file mtime is stale. Core `acquire()` remains
synchronous and IO-free.

Acceptance: `kiln auth opencode link` with a new key in one shell causes the
pool in a running gateway process to include the new credential within 5 s.
No restart required.

### Slice 9 — Observability

Add per-credential telemetry to each pool entry: request count (success and
error), last-success timestamp, last-exhausted timestamp, current cooldown
state.

Surfaced via:
- `kiln auth <provider> status` — table showing all entries for that provider
  with name, tier, request count, and current health (`ok`, `cooling`,
  `exhausted`).
- Gateway `/observability` endpoint — pool health included in the provider
  section for each active pool.

No new persistent store — telemetry is in-process only and resets on gateway
restart.

Acceptance: `kiln auth opencode status` output includes per-entry health
columns; gateway observability JSON includes `credentialPool` section per
provider. Confirmed via integration test.

## Verification Gates

- No provider adapter contains pool logic. The pool is the only consumer
  of rotation and cooldown decisions.
- `CredentialPool` is fully unit-testable with zero IO. All IO is isolated to
  `@kilnai/runtime` adapters.
- On exhaustion of all credentials, the pool surfaces `ALL_CREDENTIALS_EXHAUSTED`
  as a typed error. The last provider-level error is attached as `cause` but
  must not bubble up unwrapped.
- `kiln auth <provider> link` on a running gateway propagates within 5 s via
  the file watcher without gateway restart.
- `bun run typecheck` and `bun run test` pass after each slice before the next
  slice begins.

## Risks and Open Questions

- **Partial-stream rate-limit**: when a 429 arrives mid-stream on a streaming
  response, the in-flight partial is discarded and the full turn is re-run on
  the next available credential. Surfacing the partial to the caller is not
  safe because it may be truncated mid-thought and indistinguishable from a
  complete response. This roadmap mandates full re-run. Callers must be aware
  that a transparent retry may double latency on a rate-limited turn.

- **Mixed-tier pools**: some providers expose meaningfully different capability
  tiers per account (OpenCode Go vs Zen; Codex Free vs Plus). Mixing tiers in
  one pool risks silently downgrading quality. Resolution: pools are typed by
  provider ID, which already encodes the tier (`opencode-go` vs `opencode-zen`
  are distinct provider IDs). Mixed-tier pools are structurally impossible if
  the pool key is the provider ID. This design is correct and requires no
  additional enforcement.

- **Wrapper-side token refresh**: harness wrapper binaries manage their own
  token lifecycle inside their assigned home directory. If one wrapper home
  hits 429, the pool rotates to another home — but the first binary continues
  auto-refreshing on its own schedule. The pool must not attempt to intercept
  or block that refresh. The contract is: pool owns home selection, wrapper
  binary owns token contents. This is safe and requires no coordination
  protocol between the pool and the binary.

- **Ollama replica differentiation**: when multiple Ollama replicas are in the
  pool, 429 and connection-refused both trigger rotation. But a connection-refused
  from a replica that is starting up should have a shorter cooldown than a 429
  from a saturated replica. The default `CooldownPolicy` applies the same
  1-h cooldown to both. This may need a refinement in a follow-on slice
  where the outcome type distinguishes `connection-refused` from `rate-limited`.

## Relation to Other Roadmaps

- `docs/architecture/tool-execution.md` and
  `docs/architecture/provider-model-discovery.md` — the pool sits beneath the
  unified tool and discovery surfaces. Tool calls flow through the adapter,
  which talks to the pool. The tool surface does not need to know about pool
  internals.
- `docs/architecture/operator-surfaces.md` - GUI model picker should display
  per-credential health (from Slice 9) once the observability endpoint is
  wired. This is a read-only display concern; the picker does not own pool
  management.
- `docs/architecture/context-governance.md` — independent. The pool does not
  interact with context assembly, budget, or ranking.

## Rules

- No dead code. When a slice removes the single-file auth path, that code is
  deleted, not commented out.
- No boilerplate wrappers. A provider integration must add a real credential
  source, mapper, or factory. Do not add pass-through classes that only rename
  existing calls.
- No redundant pool logic. Selection, cooldown, lease accounting, and health
  projection live in the credential-pool package only. Provider integrations
  supply auth values and error mappings.
- No duplicate credential readers. If CLI, gateway, and GUI need credential
  state, they call the same runtime service instead of parsing the same files
  independently.
- No legacy aliasing. `~/.kiln/auth/opencode.json` (single-file) and
  `~/.kiln/auth/opencode/*.json` (pool) cannot coexist. The migrator writes the
  directory form and deletes the single file at first `link` invocation.
  There is no shim that reads both.
- DDD: pool domain types in `@kilnai/core`. File IO and file watcher in
  `@kilnai/runtime`. CLI commands in `@kilnai/cli`. No package may import
  upward.
