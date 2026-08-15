# Operate the Model Gateway

Model Gateway lets Codex, Claude Code, and OpenCode use virtual models backed
by Kiln's global target catalog. It is an authenticated, user-scoped loopback
service. Kiln Runtime remains the authority for target admission, accounts,
credentials, capacity, provider dispatch, and terminal evidence.

The harnesses share model access, not agent identity. Each harness keeps its
own tools, permissions, prompts, sessions, and agent loop.

## Projection scope

| Harness | Projection | Effect |
| --- | --- | --- |
| Codex | Global Codex config and generated merged catalog | Native and admitted Kiln virtual models share one picker and authenticated composite listener. |
| Claude Code | Project `.claude/settings.json` | The project uses the loopback Anthropic Messages endpoint and admitted Claude-compatible virtual IDs. |
| OpenCode | Global OpenCode provider config | An additive `kiln` provider exposes admitted virtual models without replacing native providers. |

Kiln records ownership and backups for managed fields. Exact uninstall restores
owned projections before it stops the listener.

## Requirements

- Global config uses schema V3 and contains `targetCatalog`, `targetRouting`,
  and `modelGateway`.
- Each virtual model references one configured `targetId`.
- Every principal and replay `*Env` reference exists in the environment used by
  supervised processes. Secret values never belong in YAML.
- Each harness has at most one principal. Codex and OpenCode use
  `openai-responses`; Claude uses `anthropic-messages` and references
  `ANTHROPIC_AUTH_TOKEN`.
- Principal tokens and the replay HMAC secret contain at least 32 random bytes,
  are unique, and are never committed or printed into evidence.

Start from the parser-validated
[task-aware model-team example](../examples/configs/task-aware-model-team.yaml).
Replace its synthetic accounts, targets, and evidence with current facts.

A virtual model contains picker and ingress metadata plus `targetId`. It does
not repeat provider, model, account policy, credentials, data policy, or
economics.

Generate each secret locally with a cryptographically secure generator. For
example:

```bash
bun -e "console.log(Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join(''))"
```

Do not paste the output into chat, logs, issues, committed files, or command
arguments.

## Install native projections

Review the canonical config and affected native files, then run:

```bash
bun packages/cli/src/index.ts model-gateway sync-native --client codex --json
bun packages/cli/src/index.ts model-gateway sync-native --client claude --project . --json
bun packages/cli/src/index.ts model-gateway sync-native --client opencode --json
```

Claude projection is project-scoped; repeat it with an explicit
`--project <path>` for every admitted project. Codex and OpenCode projections
are user-global.

Projection is additive and ownership-aware:

- Codex keeps native providers and models and receives Kiln's owned composite
  provider and catalog entries.
- OpenCode keeps native providers and receives one additive `kiln` provider.
- Claude receives only the owned project settings required for the admitted
  Messages ingress and virtual model selection.

Unmanaged fields remain untouched. Drifted managed fields block replacement
unless the explicit force workflow is reviewed and approved.

## Start and inspect the listener

```bash
bun packages/cli/src/index.ts model-gateway start --json
bun packages/cli/src/index.ts model-gateway status --json
```

The listener binds to loopback. Status must identify the exact owned instance,
port, configured principals, and projection health without exposing tokens or
credential material.

To inspect the operator catalog and default before using a native harness:

```bash
bun packages/cli/src/index.ts target
bun packages/cli/src/index.ts config read health
bun packages/cli/src/index.ts config read setup
```

## Request flow

1. The listener authenticates the principal and validates ingress limits.
2. It resolves the requested virtual model to its configured `targetId`.
3. Runtime admits that target against current identity, data-policy, capability,
   account, quota, capacity, and economic evidence.
4. Runtime fences the exact account and credential revision.
5. The provider adapter dispatches the committed request.
6. Runtime streams canonical events and records terminal settlement.

Runtime may assign an internal `routeId` to the admitted execution. That value
is durable evidence for lifecycle and replay. Operators configure and select
the target, not the internal route identity.

## Limits and cancellation

OpenAI Responses and Anthropic Messages ingress have independent configured
body and concurrency limits. Codex composite traffic also separates response,
compaction, and auxiliary request classes so background work cannot silently
occupy all response capacity.

Queued cancellation removes the waiter. A local queue timeout or full queue is
a pre-dispatch HTTP 503 with sanitized evidence. Provider HTTP 429 responses
remain provider outcomes; the native composite branch cannot invent account
cooldown evidence without an admitted account commitment.

## Native tools on virtual models

The native harness remains the executor for tools it advertises. A virtual
model's target must have current evidence for every required transport
capability. Missing evidence rejects the request instead of silently dropping
the tool.

Codex virtual models use `tool_mode: direct`. Kiln preserves a verified native
function-tool transport only when the target admits it. Freeform and
grammar-based custom tools remain unavailable on provider-adapter targets until
a preserving transport is implemented and proven.

Do not add capability labels to make a request pass. Add them only after the
selected target has current transport proof.

## Known Codex history limitation

Codex currently has a native history/UI limitation for conversations created
through a custom `model_provider`. Threads may remain in Codex storage without
appearing in its sidebar. Model Gateway cannot repair a UI owned by Codex and
does not rewrite Codex SQLite. Kiln reports degraded visibility rather than
claiming data loss. Kiln GUI and TUI continue to list canonical Kiln sessions.

## Exact uninstall

```bash
bun packages/cli/src/index.ts model-gateway uninstall
```

Uninstall verifies ownership, restores the owned Codex, Claude, and OpenCode
projections, and only then stops the exact listener. Projection drift or a
restore failure leaves the listener running so native clients are not stranded
on a dead endpoint.

The command does not modify global target config, provider credentials,
unmanaged native fields, or Runtime's shared economic authority.

To remove only automatic startup:

```bash
bun packages/cli/src/index.ts model-gateway uninstall-autostart
```

## Verification

After setup or removal:

```bash
bun packages/cli/src/index.ts model-gateway status --json
bun packages/cli/src/index.ts config read setup
```

Verify the intended native picker entries, authenticated request path,
cancellation, projection ownership, and exact listener lifecycle. A healthy
listener alone does not prove that every native projection is current.
