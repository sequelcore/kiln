# 06 — Provider Credential Pool

## Goal

Kiln currently holds exactly one credential per provider. This blocks scaling
beyond a single subscription's rate limit and has no recovery path when an
individual credential hits a 429 or 402 mid-session. The credential pool
introduces a provider-agnostic layer that manages multiple credentials per
provider, rotates them, tracks per-credential cooldowns, and presents a single
adapter surface to upstream callers. It applies equally to subscription-auth
providers (`codex-oauth`, `opencode-go`, `opencode-zen`), direct API-key
providers (`anthropic`, `openai`, `deepseek`, `openrouter`, `ollama`), and
harness-wrapped providers (`claude-code`, `codex`, `opencode`).

## Scope

| Category | Example providers | Credential type | Pool behavior | Notes |
|----------|-------------------|-----------------|---------------|-------|
| Subscription-auth | `codex-oauth`, `opencode-go`, `opencode-zen` | Stored auth JSON (token or API key) | Rotate on 429/402; cooldown to server-supplied `resetAt` or 1 h default | Multiple accounts = multiple JSON files under `~/.kiln/auth/<provider>/` |
| Direct API-key | `anthropic`, `openai`, `deepseek`, `openrouter` | API key string | Rotate on 429/402; per-key cooldown tracking | Env-var fallback still valid for single-key mode |
| Self-hosted / local | `ollama` | Endpoint URL (no key) | Rotate across endpoint replicas; 429 and connection-refused both trigger rotation | Multiple replicas = multiple entries |
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

### Package location

New directory: `packages/core/src/agents/credential-pool/`

Following Clean Architecture: domain types and selection policy live in
`@kilnai/core` with no IO. File-system credential loading and file-watcher
logic live in `@kilnai/runtime`. CLI commands that read/write credentials
stay in `@kilnai/cli`.

### Domain entities

- `Credential<TAuth>` — an auth value plus lease metadata: last-success,
  last-exhausted, cooldown-until, soft-lease count, and a tier tag for
  providers that have meaningfully different capability tiers (e.g. Go vs
  Zen, Pro vs Plus).
- `CredentialPool<TAuth>` — a named, typed collection of `Credential<TAuth>`
  instances. Exposes `acquire(): Promise<Lease<TAuth>>` and
  `report(lease: Lease<TAuth>, outcome: CredentialOutcome): void`.
- `SelectionStrategy` — policy enum: `fill-first` (exhaust one credential
  before moving), `round-robin`, `random`, `least-used`. Applies within
  the set of credentials not currently in cooldown.
- `CooldownPolicy` — defines default cooldown duration (1 h) and the rule
  for accepting a server-supplied `resetAt` override from the error response.
- `PooledAdapter<T extends ProviderAdapter>` — wraps any existing adapter
  with pool-aware acquire/report/retry. On caught `PROVIDER_RATE_LIMITED`
  or `PROVIDER_QUOTA_EXCEEDED`, marks the current lease exhausted and
  transparently retries on the next available credential until budget is
  exhausted or no usable credentials remain, at which point it surfaces
  `ALL_CREDENTIALS_EXHAUSTED`.
- `CredentialOutcome` — typed discriminated union: `ok`, `rate-limited`
  (with optional `resetAt`), `quota-exceeded`, `auth-failed`, `unknown-error`.

### Core contract

```
acquire() -> Lease<TAuth>    // blocks if pool temporarily empty, throws if all exhausted
report(lease, outcome)       // updates cooldown state; never throws
```

The pool never leaks provider-specific error types. Every error that reaches
`report()` must first be mapped to `CredentialOutcome` by the adapter layer.

### Cross-process coordination

File-system watcher (in `@kilnai/runtime`) monitors `~/.kiln/auth/**/*.json`
for mtime changes. On change, the pool for the affected provider invalidates
its cached credential entries and reloads from disk. This ensures that
`kiln auth <provider> link` in one shell propagates to running workers in
another without restart. Pattern derived from `hermes-agent`
`mcp_oauth_manager.py` mtime-based reload.

## Slice Plan

### Slice 1 — Domain types

Create `packages/core/src/agents/credential-pool/` with:
- `credential.ts` — `Credential<TAuth>`, `Lease<TAuth>`, `CredentialOutcome`
- `pool.ts` — `CredentialPool<TAuth>` with `acquire` and `report` contracts
- `strategies.ts` — `SelectionStrategy` enum and selection logic
- `cooldown.ts` — `CooldownPolicy` with default and server-supplied `resetAt`
- `outcome.ts` — `ALL_CREDENTIALS_EXHAUSTED` error type

No IO. Provider-agnostic. Unit tests for each entity with zero mocks needed.

Acceptance: `bun run typecheck` passes; all pool entity tests pass with
simulated credential lists; `acquire()` throws `ALL_CREDENTIALS_EXHAUSTED`
when every credential is in cooldown.

### Slice 2 — Adapter wrapper

Add `PooledProviderAdapter<T extends ProviderAdapter>` in
`packages/core/src/agents/credential-pool/pooled-adapter.ts`.

Takes a `CredentialPool<TAuth>` and a factory `(auth: TAuth) => T`. Implements
`createMessage` and `streamMessage` with the acquire → call → report → retry
loop. Retry continues only on `rate-limited` or `quota-exceeded` outcomes.
Auth errors and unknown errors propagate immediately without retry.

Acceptance: unit tests covering single-credential exhaustion, two-credential
rotation, and mid-stream rate-limit handling (full turn re-run, not partial
surface). `bun run test` passes.

### Slice 3 — OpenCode integration

Wire `opencode-go` and `opencode-zen` through the pool.

Auth directory: `~/.kiln/auth/opencode/`. Each file is a `{name}.json` with
the same shape as the current single `~/.kiln/auth/opencode.json`. The first
`link` command targeting a directory-less setup migrates the existing single
file into `~/.kiln/auth/opencode/default.json` and removes the top-level
file. No compatibility shim — after migration only the directory form exists.

`OpenCodeAuth` is extended to load from either form but writes only to the
directory form. A `OpenCodeCredentialPool` factory in `@kilnai/runtime`
builds the pool from all `*.json` files in the directory.

Acceptance: `kiln auth opencode link` with a second key creates a second
entry; `kiln auth opencode status` lists both entries with per-entry health.
`OpenCodeAdapter` via `PooledProviderAdapter` rotates to the second credential
on a simulated 429. Pool-entry count is visible in gateway observability.

### Slice 4 — Codex OAuth integration

Wire `codex-oauth` through the pool.

Auth directory: `~/.kiln/auth/codex-oauth/`. Same directory-of-files pattern.
Migration: existing `~/.kiln/auth/codex-oauth.json` → `~/.kiln/auth/codex-oauth/default.json`.

`CodexOAuthAuth` extended to load from directory. `CodexOAuthCredentialPool`
factory mirrors the OpenCode pool factory.

Acceptance: two Codex OAuth accounts rotate correctly; `kiln auth codex-oauth
status` shows per-entry health.

### Slice 5 — Direct API-key providers

Wire `anthropic`, `openai`, `deepseek`, `openrouter`, `ollama` through the pool.

Auth directory per provider: `~/.kiln/auth/<provider>/`. Each file is a
`{name}.json` containing the API key (and base URL for `ollama`). Env-var
fallback (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) remains valid and is
treated as a synthetic single-entry pool with the name `env`.

Key point: env-var single-key mode must not require migration. The pool loader
checks for a directory, then for env-var; it never requires the user to
convert a working env-var setup.

Acceptance: multi-key `anthropic` pool rotates on 429; env-var single-key
path is not broken; `bun run test` passes.

### Slice 6 — Harness provider passthrough

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

### Slice 7 — Cross-process reload

Add `CredentialWatcher` in `packages/runtime/src/agents/credential-pool/`.
Watches `~/.kiln/auth/**/*.json` with mtime-based polling (500 ms interval
when active; longer when idle). On mtime change, invalidates the pool for the
affected provider and reloads credentials from disk.

The watcher is started by the gateway on startup and stopped on shutdown.
Worker processes that do not run a gateway use a one-shot reload triggered
by the first `acquire()` call after the file mtime is stale.

Acceptance: `kiln auth opencode link` with a new key in one shell causes the
pool in a running gateway process to include the new credential within 5 s.
No restart required.

### Slice 8 — Observability

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

- `03-shared-tool-surface-unification.md` — the pool sits beneath the unified
  tool surface. Tool calls flow through the adapter, which talks to the pool.
  The tool surface does not need to know about pool internals.
- `04-operator-surfaces-and-remote-gui.md` — GUI model picker should display
  per-credential health (from Slice 8) once the observability endpoint is
  wired. This is a read-only display concern; the picker does not own pool
  management.
- `05-context-governor-unification.md` — independent. The pool does not
  interact with context assembly, budget, or ranking.

## Rules

- No dead code. When a slice removes the single-file auth path, that code is
  deleted, not commented out.
- No legacy aliasing. `~/.kiln/auth/opencode.json` (single-file) and
  `~/.kiln/auth/opencode/*.json` (pool) cannot coexist. The migrator writes the
  directory form and deletes the single file at first `link` invocation.
  There is no shim that reads both.
- DDD: pool domain types in `@kilnai/core`. File IO and file watcher in
  `@kilnai/runtime`. CLI commands in `@kilnai/cli`. No package may import
  upward.
