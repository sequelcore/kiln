# Provider Credential Pools

## Purpose

Provider credential pools are the runtime-owned contract for using more than
one credential, account, endpoint, or harness home for a provider family.

The pool decides which credential may be used for a provider call, records the
result, cools unhealthy entries down, and exposes secret-free health evidence
to operator surfaces. Provider adapters execute requests; they do not own
rotation, cooldown, retry policy, status files, or cross-process reload.

## Provider Classes

Credential pooling covers four provider classes:

- Subscription-auth providers such as `codex-oauth`, `opencode-go`, and
  `opencode-zen`.
- Direct API-key providers such as `anthropic`, `openai`, `deepseek`, and
  `openrouter`.
- Local endpoint providers such as `ollama` and `lmstudio`.
- Harness-wrapped providers such as `claude-code`, `codex`, and `opencode`,
  where the credential entry selects a harness home directory.

Mixed subscription tiers are represented by distinct provider routes. For
example, OpenCode Go and Zen calls are routed as `opencode-go` and
`opencode-zen`, even though their stored credentials live under the same
OpenCode pool provider.

## Architecture Boundary

`@kilnai/core` owns the pure domain model:

- `Credential`
- `CredentialPool`
- `SelectionStrategy`
- `CooldownPolicy`
- `CredentialOutcome`
- `CredentialPoolSnapshot`
- `CredentialPoolStatePort`
- `PooledProviderAdapter`

Core code is IO-free. It does not know about `~/.kiln`, JSON files, provider
SDKs, environment variables, gateway routes, or CLI commands.

`@kilnai/runtime` owns operational integration:

- credential file parsing and validation
- provider-specific credential services
- provider-specific error-to-outcome mapping
- health persistence
- file watching and pool reload
- observability registration
- adapter factories for pooled providers

`@kilnai/cli` owns operator commands. CLI commands call runtime services; they
do not implement private pool parsing or provider rotation logic.

## Storage

The canonical credential root is:

```text
~/.kiln/auth/
```

Each pooled provider owns a directory under that root. Each credential is one
JSON file inside the provider directory:

```text
~/.kiln/auth/<provider>/<credential-id>.json
```

General credential files use this shape:

```json
{
  "id": "work",
  "label": "Work account",
  "providerId": "openai",
  "source": "manual",
  "priority": 0,
  "auth": {
    "apiKey": "..."
  },
  "createdAt": "2026-05-02T00:00:00.000Z",
  "updatedAt": "2026-05-02T00:00:00.000Z"
}
```

Provider-specific services may use narrower provider-native file shapes where
that avoids redundant wrapping. OpenCode stores tiered API-key files under
`~/.kiln/auth/opencode/`. Codex OAuth stores token files under
`~/.kiln/auth/codex-oauth/`.

Health data is runtime-owned metadata. It is stored separately from credential
secrets and is ignored by the credential watcher.

## Selection And Cooldown

The default selection strategy is `fill-first`. Entries are sorted by priority
and credential ID when loaded from disk.

Every provider call follows the same lifecycle:

1. Acquire a soft lease from the pool.
2. Create a provider adapter with the leased auth payload.
3. Execute the request.
4. Map the provider result or error to a `CredentialOutcome`.
5. Report the outcome to the pool.
6. Persist health through the `CredentialPoolStatePort`.

Retryable outcomes cool the credential down instead of immediately reusing it.
Current retryable outcomes include rate limits, quota exhaustion, connection
failures, and unknown provider errors. Authentication failures are not treated
as retryable for the same credential.

If no credential is available, the pool raises `AllCredentialsExhaustedError`.
The error preserves the last provider error and outcome when exhaustion happens
after one or more retry attempts.

## Pooled Adapter Contract

`PooledProviderAdapter` is the only generic wrapper that combines pool
selection with provider execution. It owns retries across credentials and keeps
the provider adapter contract unchanged.

For non-streaming calls, a retryable failure is reported to the pool and the
next attempt acquires another available credential. For streaming calls, events
from a failed attempt are buffered and discarded; partial text from a failed
credential is never yielded to the caller before the attempt is known to have
succeeded.

Provider adapters should disable their own internal credential retries when
wrapped by `PooledProviderAdapter`. The pool must remain the source of truth
for rotation and cooldown.

## Runtime Credential Sources

Direct providers first load canonical credential files from
`~/.kiln/auth/<provider>/`. If no files exist, direct providers may synthesize a
single environment credential from the provider's environment variables.
Environment fallback is the preferred local setup for single-key gateways such
as OpenRouter because it keeps secrets outside declarative config while avoiding
manual credential-file authoring. Credential files are reserved for explicit
adoption flows, multi-account pools, priority selection, cooldown, and rotation.
Secrets must never be stored in `~/.kiln/config.yaml` or project
`.kiln/kiln.yaml`; those files describe routing and policy only.

Current environment fallbacks are:

| Provider | API key | Base URL |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | none |
| `openai` | `OPENAI_API_KEY` | none |
| `deepseek` | `DEEPSEEK_API_KEY` | none |
| `openrouter` | `OPENROUTER_API_KEY` | none |
| `ollama` | none | `OLLAMA_BASE_URL`, default `http://localhost:11434` |
| `lmstudio` | `LMSTUDIO_API_KEY` | `LMSTUDIO_BASE_URL`, default LM Studio URL |

Harness providers use a credential file whose auth payload points at a harness
home directory:

```json
{
  "auth": {
    "homeDir": "C:/Users/Ricardo/.codex-work"
  }
}
```

At execution time the wrapper projects the selected home through the harness
environment, such as `CLAUDE_HOME`, `CODEX_HOME`, or
`OPENCODE_CONFIG_DIR`. Harness token refresh remains the harness adapter's
responsibility.

## Cross-Process Reload

`CredentialWatcher` scans `~/.kiln/auth/**/*.json`, ignores `.health/`, and
uses nanosecond file modification time when the platform exposes it. Changed
provider directories trigger registered pools to reload credentials.

Reload keeps the pool object stable. Existing runtime components continue to
hold the same pool instance while its credential entries are replaced from the
canonical store.

Operator-facing behavior should converge within the watcher interval. Runtime
tests use shorter intervals; production consumers should assume credential
changes become visible within a few seconds.

## Observability

The credential observability registry exposes live pool snapshots without
secrets. A snapshot contains:

- provider route
- pool provider ID
- selection strategy
- aggregate metrics
- credential ID
- label
- source
- priority
- tier
- health
- request count
- last success timestamp
- last exhausted timestamp
- cooldown deadline

The gateway includes these snapshots in `GET /observability`. When gateway JWT
auth is configured, the endpoint requires the same bearer-token boundary as
other protected operator routes.

Multiple active pools for the same underlying provider are registered as
separate observations. This preserves tiered or route-specific views such as
`opencode-go` and `opencode-zen`.

## Security Invariants

- Credential secrets are never emitted through status, observability, events,
  or logs.
- Runtime services validate credential file shape before admitting entries into
  a pool.
- Provider IDs and credential IDs are path segments and must pass safe-segment
  validation.
- Operator surfaces receive health and availability evidence, not raw auth
  payloads.
- Provider credential pools are per Kiln instance. Cross-instance credential
  sharing requires explicit future policy and audit support.
- Local endpoint providers do not imply cloud auth, and cloud credentials do
  not imply local daemon availability.

## Current Limits

Credential pools govern authentication and provider-request cooldown. They do
not schedule local model loading, LM Studio profile activation, or local daemon
lifecycle. Those concerns belong to provider availability and model discovery.

Credential pools also do not replace provider/model route health. A credential
can be valid while a specific advertised model route is cooling down, such as an
OpenRouter free upstream returning a model-specific `429`. Runtime routing must
combine credential health with provider/model route health before admitting
work or selecting fallbacks.

`connection-failed` currently uses the default cooldown policy. Provider-specific
backoff refinement can be added through the existing outcome and cooldown
contracts without changing the pool boundary.

## Related

- [Provider Credentials](../guides/provider-credentials.md)
- [Observability](../guides/observability.md)
- [Provider Model Discovery](provider-model-discovery.md)
- [Tool Execution](tool-execution.md)
