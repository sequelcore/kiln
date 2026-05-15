# Provider Credentials

## Purpose

This guide covers operator workflows for provider credentials in Kiln. The
architecture contract is documented in
[`docs/architecture/provider-credential-pools.md`](../architecture/provider-credential-pools.md).

Provider credentials are managed as pools. A pool may contain multiple
accounts, API keys, endpoint definitions, or harness homes. Kiln selects one
entry for each provider call, records health, and cools unhealthy entries down.

## Credential Root

The canonical credential root is:

```text
~/.kiln/auth/
```

Each provider owns a directory:

```text
~/.kiln/auth/<provider>/
```

Each credential is a JSON file in that directory. Runtime services validate the
file before admitting it into a pool. Status output and observability snapshots
mask or omit secrets.

## Subscription Auth Commands

Codex OAuth:

```bash
kiln auth codex login
kiln auth codex status
kiln auth codex logout
```

OpenCode:

```bash
kiln auth opencode link [--tier go|zen] [--id <id>] [--key <key>]
kiln auth opencode import [--tier go|zen] [--id <id>]
kiln auth opencode status [--tier go|zen] [--id <id>]
kiln auth opencode logout [--tier go|zen] [--id <id>]
```

All providers:

```bash
kiln auth status
```

`kiln auth codex login` starts the provider authorization flow and stores the
result under `~/.kiln/auth/codex-oauth/`.

`kiln auth opencode link` stores an OpenCode API key under
`~/.kiln/auth/opencode/`. Without `--key`, Kiln first tries to import the key
from the local OpenCode config and then falls back to an interactive paste.
OpenCode Go and Zen credentials are stored as separate tiered entries. The
default credential ids are `go-primary` and `zen-primary`; pass `--id` to manage
multiple accounts or named workspaces. `status` and `logout` accept the same
`--tier` and `--id` filters so operators can inspect or remove one credential
without touching the other tier.

Logout commands remove the provider's linked credential files. They do not
modify unrelated provider directories.

## Direct Providers

Direct providers can be configured by placing credential files under their
provider directory:

```text
~/.kiln/auth/anthropic/work.json
~/.kiln/auth/openai/personal.json
~/.kiln/auth/openrouter/team.json
```

When a direct provider directory has no files, Kiln may fall back to a single
environment credential for that provider. This is the recommended local setup
for single-account API-key gateways such as OpenRouter: keep the key in the
operator's environment and keep routing, models, and managed-agent policy in
Kiln config. Do not put API keys in `~/.kiln/config.yaml` or project
`.kiln/kiln.yaml`.

On Windows, persist an OpenRouter key for new terminals with:

```cmd
setx OPENROUTER_API_KEY "<openrouter-api-key>"
```

Open a new terminal before running Kiln again; `setx` does not update the
already-running shell. For a one-off current terminal session, set the process
environment instead of writing config:

```cmd
set OPENROUTER_API_KEY=<openrouter-api-key>
```

Credential files under `~/.kiln/auth/<provider>/` remain the canonical long-term
pooling shape when Kiln manages multiple accounts, priorities, health, and
rotation. For OpenRouter, prefer the environment variable until an explicit
`kiln auth openrouter` adoption flow writes and validates the credential file.

Supported environment fallbacks:

| Provider | Environment |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `ollama` | `OLLAMA_BASE_URL`, default `http://localhost:11434` |
| `lmstudio` | `LMSTUDIO_API_KEY`, `LMSTUDIO_BASE_URL` |

Local endpoint providers still require model discovery before execution.
Credential availability does not prove that a local daemon is reachable or that
a model is loaded.

## Harness Providers

Harness provider entries select a harness home directory. This lets Kiln run
the same harness through different local accounts or profiles without
duplicating provider execution logic.

Harness pool provider IDs:

| Provider | Runtime environment projection |
|---|---|
| `claude-code` | `CLAUDE_HOME` |
| `codex` | `CODEX_HOME` |
| `opencode` | `OPENCODE_CONFIG_DIR` |

The selected harness home belongs to the child process launched by Kiln. The
harness adapter remains responsible for provider-native token refresh and
provider-specific auth mechanics.

## Health States

Credential health is derived from the pool snapshot:

| State | Meaning |
|---|---|
| `ok` | The credential is eligible for selection. |
| `cooling` | The credential is temporarily unavailable after a retryable failure. |
| `exhausted` | The credential hit rate limit, quota, or another exhaustion outcome and is cooling down. |

Status output includes request counts and cooldown deadlines where available.
Timestamps are operational evidence; they are not credential secrets.

## Reload Behavior

Running Kiln processes watch `~/.kiln/auth/**/*.json` for changes and reload
affected provider pools. `.health/` metadata is ignored by the watcher.

Credential changes should become visible to active processes within a few
seconds. If a process was started before a credential directory existed, the
same watcher still detects the new provider files after they are written.

## Observability

Gateway `GET /observability` includes credential-pool snapshots when providers
are registered. When gateway JWT auth is configured, this endpoint requires a
valid bearer token.

Observability snapshots expose provider route, pool metrics, entry IDs, labels,
sources, tiers, priorities, health, request counts, and cooldown timestamps.
They never expose API keys, OAuth tokens, or harness auth files.

## Operating Rules

- Use provider directories under `~/.kiln/auth/` as the source of truth.
- Keep one concern per credential file: one account, API key, endpoint, or
  harness home.
- Use distinct provider routes for distinct subscription tiers.
- Do not copy credentials between Kiln instances as an implicit sync
  mechanism.
- Treat status and observability as health evidence, not as a secret export
  path.

## Related

- [Provider Credential Pools](../architecture/provider-credential-pools.md)
- [Provider Model Discovery](../architecture/provider-model-discovery.md)
- [Observability](observability.md)
