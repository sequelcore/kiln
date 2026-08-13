# Model Gateway Operations

Model Gateway is the user-scoped loopback ingress for virtual models configured
in `~/.kiln/config.yaml`. Its principals expose OpenAI Responses or Anthropic
Messages while Runtime remains the only account, credential, capacity, and
dispatch authority.

## Prerequisites

- Global config is V2 and declares `executionCatalog`, `executionRouting`, and
  `modelGateway`.
- Every replay and principal `*Env` reference exists in the user environment
  available to supervised processes. Secret values never belong in YAML,
  command output, issue evidence, or scheduled-task arguments.
- Each virtual model references one canonical `executionRouteId`.

Validate without printing secrets:

```powershell
kiln model-gateway doctor --json
```

`ready` is valid only when the listener identity, PID, version, port, and config
digest match owned state and `diagnostics` is empty.

Use provider-aligned request envelopes in canonical config:

```yaml
modelGateway:
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

## Why Native Codex Requests Use The Kiln URL

Kiln projects a composite base URL into Codex so one model selector can expose
native Codex models and Kiln virtual models. The URL is a dispatch boundary,
not proof that Kiln selected or executed the model.

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

```powershell
kiln model-gateway start
kiln model-gateway status
kiln model-gateway restart
kiln model-gateway stop
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

### Retained capacity incidents

With the listener stopped, inspect post-fence work whose provider outcome is
still unknown:

```powershell
kiln model-gateway capacity-incidents --json
```

The command opens the ledger read-only and returns every capacity-consuming
account-only record in the `model-gateway-ingress/model-gateway` recovery
domain, including `release-failed` and `leaked`. The projection contains only
invocation, state, route, optional dispatch fence, and any existing
unknown-settlement reason. Inspection does not claim a participant generation,
advance a heartbeat, run recovery, expose account identities, or release
capacity.

There is intentionally no manual outcome flag or generic reconciliation
command. A user-supplied status, timestamp, or `kiln://` string is not provider
terminal evidence. If no authoritative terminal result exists, the incident
remains `settlement-pending` and capacity-consuming. Do not edit the SQLite
ledger or replace `unknown` with a guessed terminal outcome.

## Windows Autostart And Recovery

```powershell
kiln model-gateway install-autostart
kiln model-gateway autostart-status
```

The installed current-user task starts `model-gateway ensure` at logon, runs at
least privilege, ignores duplicate starts, and has no scheduler execution time
limit. Run `install-autostart` again after changing the installed CLI entrypoint
or version; the ownership digest makes this an exact update. Then run:

```powershell
kiln model-gateway restart
kiln model-gateway doctor --json
```

Recovery proof consists of stopping the service, running the owned task (or
logging into a fresh operator session), and observing `ready` with the expected
version and config digest.

## Exact Uninstall

```powershell
kiln model-gateway uninstall
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
available, use `kiln model-gateway uninstall-autostart`.
