# Operate the Model Gateway

The Model Gateway lets Codex, Claude Code, and OpenCode use virtual models from
Kiln's canonical execution catalog. It runs as an authenticated, user-scoped
service bound to loopback. Kiln Runtime remains the only authority for routes,
accounts, credentials, capacity, and provider dispatch.

The harnesses share model access, not agent identity. Each harness keeps its
own tools, permissions, prompts, sessions, and agent loop.

## What setup changes

| Harness | Projection | Effect |
| --- | --- | --- |
| Codex | Global Codex config and a generated merged catalog | Native Codex models and admitted Kiln virtual models appear in one picker; all model requests enter the authenticated composite listener. |
| Claude Code | Project `.claude/settings.json` | The project uses the loopback Anthropic Messages endpoint and the admitted Claude-compatible virtual model IDs. |
| OpenCode | Global OpenCode provider config | An additive `kiln` provider exposes admitted virtual models without replacing the native provider. |

Kiln records ownership and backups for every managed field. Exact uninstall
restores projections before stopping the listener, so a harness is not left
pointing at a dead local endpoint.

## Before you begin

- Global config is V2 and declares `executionCatalog`, `executionRouting`, and
  `modelGateway`.
- Every replay and principal `*Env` reference exists in the user environment
  available to supervised processes. Secret values never belong in YAML,
  command output, issue evidence, or scheduled-task arguments.
- Each virtual model references one canonical `executionRouteId`.
- Each native harness has at most one principal. Codex and OpenCode principals
  use `openai-responses`; Claude uses `anthropic-messages` and must reference
  `ANTHROPIC_AUTH_TOKEN`.
- Every principal token and the replay HMAC secret contain at least 32 random
  bytes. Token values are unique and never stored in YAML.

Start from the parser-validated
[task-aware model-team example](../examples/configs/task-aware-model-team.yaml).
Replace its synthetic accounts, routes, capability metadata, and evidence with
facts for your installation. `modelGateway.virtualModels` contains only picker
metadata and an `executionRouteId`; it must not repeat provider, credential,
account, or economic authority.

Generate secrets locally with a cryptographically secure random-number
generator and store them in the user environment available to supervised
processes. For example, this Bun command prints 32 random bytes as hexadecimal:

```bash
bun -e "console.log(Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''))"
```

Run it independently for every token. Do not paste the output into chat, logs,
issues, committed files, or command arguments.

## Install native projections

The following commands mutate native configuration and start or reuse the
owned listener. Run them from the repository root only after reviewing the
canonical config and native files in scope:

```bash
bun packages/cli/src/index.ts model-gateway sync-native --client codex --json
bun packages/cli/src/index.ts model-gateway sync-native --client claude --project . --json
bun packages/cli/src/index.ts model-gateway sync-native --client opencode --json
```

The Claude projection is project-scoped; repeat it with an explicit
`--project <path>` for each project that should use the Gateway. Codex and
OpenCode projections are user-global. A foreign field or unowned drift fails
closed unless you explicitly choose the documented adoption or force flow
after reviewing the affected native config.

On Windows, install current-user logon startup only after all required
projections succeed:

```bash
bun packages/cli/src/index.ts model-gateway install-autostart --json
```

## Verify setup

Validate without printing secrets:

```bash
bun packages/cli/src/index.ts model-gateway doctor --json
```

`ready` is valid only when the listener identity, PID, version, port, and config
digest match owned state and `diagnostics` is empty. Open a new session in each
configured harness and confirm that its admitted virtual models appear before
running a provider-backed turn. A picker entry proves projection and discovery;
only a real bounded turn proves provider compatibility and entitlement.

## Configure ingress limits

Use provider-aligned request envelopes in canonical config:

```yaml
modelGateway:
  codexComposite: # required only with a nativeHarness: codex principal
    maxQueuedRequests: 32
    queueTimeoutMs: 30000
  surfaces:
    openAIResponses:
      maxBodyBytes: 67108864 # 64 MiB; Codex tool schemas and compacted history
      maxConcurrentRequests: 1
    anthropicMessages:
      maxBodyBytes: 33554432 # 32 MiB; direct Claude Messages maximum
      maxConcurrentRequests: 1
```

These are hard byte ceilings, not targets. A 413 with
`x-kiln-request-body-limit-bytes` came from Kiln; compact the session if the
request also approaches the model's useful token budget. After changing the
canonical config, restart and run `doctor` so the owned listener's config digest
converges. Do not edit native Codex or Claude projections to change this limit.

For Codex composite requests, the adapter-owned `codexComposite` policy creates
a bounded FIFO queue before the router reads or decodes the body. This prevents
queued requests from amplifying application memory use; only admitted requests
can hold the configured body buffer. Queue-full and queue-timeout responses are HTTP 503 with
`origin: ingress`, `phase: pre-dispatch`, a retry hint, and a correlation ID;
they are local pressure, never a provider rate limit. An HTTP 429 forwarded by
the composite remains an upstream Codex response.

Route class and capability-path validation happen before the queue. Native
authorization and model-body validation happen after admission, so malformed or
unauthenticated traffic can occupy only a bounded ingress wait slot and never
causes body decoding or upstream dispatch.

## Why native Codex requests use the Kiln URL

Kiln projects an OAuth-backed custom provider and composite base URL into Codex
so one model selector can expose native Codex models and Kiln virtual models.
The provider uses the HTTP Responses wire API with WebSocket support explicitly
disabled; this avoids reconnect/fallback delays without changing Codex login or
model behavior. The URL is a dispatch boundary, not proof that Kiln selected or
executed the model.

| Selected model ID | Listener action | Execution owner |
| --- | --- | --- |
| Native/default Codex model | Validate and forward to the Codex backend | Codex |
| Kiln virtual model admitted to the principal | Resolve its configured `executionRouteId` | Kiln Runtime |

For example, this URL shows that the request entered the composite listener:

```text
http://127.0.0.1:4819/.well-known/kiln/codex-composite/<capability>/v1/responses
```

It does not identify which branch was selected. Use the requested model ID to
distinguish a native Codex turn from a Kiln virtual-model turn. Never publish or
copy the capability segment from a real installation; treat it as local
authentication material.

When troubleshooting:

1. If the response includes `x-kiln-request-body-limit-bytes`, Kiln rejected the
   request before model dispatch. Reduce or compact the request, or review the
   canonical ingress limit.
2. If a native model request passed ingress and the upstream Codex backend
   rejected it, use the upstream request ID and Codex diagnostics.
3. If a virtual model failed after ingress, inspect Kiln route admission and
   Runtime evidence for its `executionRouteId`.

### Long-running requests and compaction

The listener retains Bun's finite transport timeout through authentication and
bounded request-body receipt. Only after authentication, concurrency admission,
and bounded body receipt does the listener take ownership of the request
lifetime and disable Bun's idle timeout. Subsequent JSON, protocol, or model
validation can still return a bounded 4xx response. A valid
`/responses/compact` call or a quiet response stream may then
wait longer than Bun's default inactivity window without the local listener
resetting the connection. Control routes, invalid credentials, overloaded
ingress, and stalled or oversized bodies never receive the unbounded lifetime. Do not add
a larger global idle timeout as an operational workaround; the global setting
has a finite ceiling and would make unrelated requests share the same policy.

Client disconnect remains the cancellation boundary. Kiln forwards that abort
signal to the selected native Codex or virtual-model upstream request. If a
client still reports `stream disconnected before completion` or
`error decoding response body`:

1. Confirm `kiln model-gateway doctor --json` reports the expected current
   listener version and config digest; restart an older listener after upgrade.
2. Confirm the listener process remained alive. A stable listener with an
   upstream request ID points to provider or intervening transport failure, not
   the former Bun idle-timeout defect.
3. Correlate timestamps and upstream diagnostics without logging request bodies,
   authorization headers, or the composite capability path segment.

## Lifecycle

```bash
bun packages/cli/src/index.ts model-gateway start
bun packages/cli/src/index.ts model-gateway status
bun packages/cli/src/index.ts model-gateway restart
bun packages/cli/src/index.ts model-gateway stop
```

`start` is idempotent. `restart` first waits for graceful resource settlement
and process exit, then launches the replacement. Every mutating command refuses
a foreign listener or stale state whose PID is still alive.

`stop` refuses while any listener-dependent Codex or Claude projection is
installed. Those projections replace the harness transport URL with the Kiln
loopback, so leaving one installed while stopping the listener would strand the
active session and every subsequent request. Use `restart` when projections must
stay active, or `uninstall` to restore native routing before stopping the
service. The additive OpenCode projection has a separate native-provider
fallback and is not a replacement transport authority.

Choose the lifecycle command by the outcome you need:

| Outcome | Command | Effect |
| --- | --- | --- |
| Apply a new build or configuration while preserving native routing | `bun packages/cli/src/index.ts model-gateway restart` | Gracefully replaces the owned listener and keeps installed projections active. |
| Stop a listener that has no dependent Codex or Claude projection | `bun packages/cli/src/index.ts model-gateway stop` | Stops only the owned listener. |
| Keep the listener off for gateway development or end-to-end testing | `bun packages/cli/src/index.ts model-gateway uninstall` | Restores native harness routing, removes gateway autostart, and then stops the owned listener. |

Do not use `stop` to prepare for gateway development when a dependent native
projection is installed. The command will fail with
`A listener-dependent native projection is installed`. This refusal does not
change the projection or listener state. Run `uninstall` instead, then confirm
the result:

```bash
bun packages/cli/src/index.ts model-gateway uninstall
bun packages/cli/src/index.ts model-gateway status
```

Use the [install native projections](#install-native-projections) procedure to
restore harness routing through Kiln after the development work is complete.

### Retained outcome incidents

Inspect post-fence work whose provider outcome is still unknown, including
while the listener is running:

```bash
bun packages/cli/src/index.ts model-gateway outcome-incidents --json
```

The command opens the ledger read-only and returns account-only records with a
durable `unknown` settlement in the `model-gateway-ingress/model-gateway`
recovery domain. The projection contains only invocation, lifecycle state,
derived local capacity state, route, dispatch fence, and the sanitized unknown
settlement. Inspection does not claim a participant generation, advance a
heartbeat, run recovery, expose account identities, or change capacity.

An authoritative terminal HTTP response is recorded as a terminal provider
outcome instead of an incident. OpenCode dispatch also projects the durable
dispatch fence as `x-opencode-request`, giving provider-side evidence a stable
correlation identity when it is available.

There is intentionally no manual outcome flag or generic reconciliation
command. A user-supplied status, timestamp, or `kiln://` string is not provider
terminal evidence. Local concurrency can be released while the provider
outcome remains unknown: the remote request may still have been accepted,
billed, or completed. Kiln preserves that uncertainty and fences redispatch of
the exact invocation; it does not turn local capacity release into a guessed
provider result. Do not edit the SQLite ledger or replace `unknown` with a
guessed terminal outcome.

## Windows autostart and recovery

```bash
bun packages/cli/src/index.ts model-gateway install-autostart
bun packages/cli/src/index.ts model-gateway autostart-status
```

The installed current-user task starts `model-gateway ensure` at logon, runs at
least privilege, ignores duplicate starts, and has no scheduler execution time
limit. Normal `start`, `ensure`, `restart`, and native sync converge an already
owned task to the current exact launch descriptor. They preserve an absent task
as operator intent; automatic convergence never enables autostart.

```bash
bun packages/cli/src/index.ts model-gateway restart
bun packages/cli/src/index.ts model-gateway doctor --json
```

Recovery proof consists of stopping the service, running the owned task (or
logging into a fresh operator session), and observing `ready` with the expected
version and config digest.

### Kiln-owned Model Gateway host

Bun 1.3.14 can terminate a long-running localhost HTTP proxy on Windows with a
native segmentation fault instead of a JavaScript exception. Kiln reproduced
that failure signature while operating the Model Gateway; it matches the
upstream [Bun Windows proxy incident](https://github.com/oven-sh/bun/issues/32585).
A native Bun panic or `bun.report` URL means the listener process exited. It is
not an application-level provider error and cannot be recovered inside the
same process.

The persistent Gateway does not inherit whichever Bun happens to launch the
CLI. Kiln resolves one content-addressed host under
`~/.kiln/runtime/model-gateway-hosts/<sha256>/`, verifies its bytes, exact
version, and revision on every resolution, and records that immutable identity
in supervisor state and the autostart digest. It never falls back to `PATH`, a
moving canary alias, or a network download during listener startup.

The current Windows admission is the exact upstream build
`1.4.0-canary.1+1cf8af0a1`, used only while no stable release fixes the incident.
Source development can adopt the already verified operator-local mitigation
once, copying it into the content-addressed store without deleting the source.
Published Kiln distributions must supply those same verified bytes as a
platform artifact; users do not install or upgrade a canary manually. A release
must fail rather than ship without its admitted host artifact.

The present source-only Windows state is deliberately narrower: it can migrate
the operator's existing verified mitigation, but a clean checkout without that
source cannot start the Gateway. The release validator, packager, and publisher
all fail closed until the platform package and its exact tarball are present.

When Bun publishes a stable fix, the release changes the admitted host identity.
Kiln verifies the replacement, drains the exact owned listener, starts and
proves readiness with the replacement, and updates an already owned logon task.
Only after state and task no longer reference the temporary artifact may the
old operator-local mitigation be removed.

### Codex compatibility and Desktop history

Codex native installation inspects one exact executable for both `--version`
and its bundled model catalog. Version `0.147.0` is currently admitted for the
Runtime wire contract `codex-0.147.0`; an unsupported or malformed version is
rejected before the listener starts and before Codex configuration changes.
The `@openai/codex-sdk` dependency used by Kiln-managed sessions is a separate
client integration and is not wire-protocol authority.

Codex Desktop currently has an upstream custom-provider history defect:
[openai/codex#28957](https://github.com/openai/codex/issues/28957). It can hide
threads created through `model_provider = "kiln"` from the sidebar even though
the threads remain in Codex storage. The Responses Gateway cannot repair that
UI because thread listing belongs to Codex app-server, not `/v1/responses`.
Kiln therefore keeps the truthful `kiln` provider identity, never rewrites
Codex SQLite, and reports the limitation as degraded visibility rather than
data loss. Kiln GUI/TUI history remains provider-neutral and continues to list
canonical Kiln sessions.

### Native harness tools on virtual models

A virtual model can request the tools that the native harness advertises, but
the harness remains the executor. The virtual route must declare every required
tool transport capability. Missing capability evidence rejects the request; it
does not silently remove the tool.

Kiln projects virtual Codex models with `tool_mode: direct`. It preserves the
verified `shell_command` transport from the native 0.147 catalog only when the
route admits `function-tools`; it does not inherit OpenAI-backend-specific code
mode metadata into a direct-provider route. Codex applies its configured sandbox
and approval policy, executes the native command, and returns the output. Kiln
never executes the command itself.

Function and namespaced-function tools use the native harness execution loop.
Freeform and Lark custom tools remain rejected on provider-adapter routes
until a grammar-preserving transport is implemented, admitted, and proven live.
Kiln does not relabel them as functions.

If a virtual route receives only conversational tools such as `wait` and
`request_user_input`, inspect the route's `modelGateway.virtualModels[].capabilities`.
Ordinary MCP and harness functions require `function-tools`. Do not add
`custom-tools-lark` to a provider-adapter route; add capabilities only
after their selected execution route has passed the corresponding transport
proof.

## Exact uninstall

```bash
bun packages/cli/src/index.ts model-gateway uninstall
```

This command checks task and listener ownership, restores the owned Codex,
Claude, and additive OpenCode projections, and only then stops the exact owned
listener. A projection drift or write failure therefore leaves the listener
running instead of stranding a harness on a dead loopback. Claude project
targets are registered in global projection state so uninstall can restore all
owned projects regardless of the current working directory. The former
project-local gateway ownership shape was migrated once for the sole operator
and is not retained as a compatibility path. After restoration it removes the scheduled task
and deletes only `~/.kiln/runtime/model-gateway`. It refuses foreign task or
listener state and does not modify global config, provider credentials,
unmanaged harness-native fields, or the shared Runtime economic authority under
`~/.kiln/runtime/economic-authority`.

To remove only automatic startup while leaving the service and runtime evidence
available, run:

```bash
bun packages/cli/src/index.ts model-gateway uninstall-autostart
```
