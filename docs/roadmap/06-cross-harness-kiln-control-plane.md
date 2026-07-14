# 06 - Cross-Harness Kiln Control Plane

Status: Active delivery track; Slices 0-2 are complete and one Slice 3 vertical slice is admitted.
Execution: Ready - implement the admitted Codex App managed-agent invocation vertical slice only.
Created: 2026-07-04.

## Objective

Make Kiln the portable control plane for agentic software work regardless of
the harness the operator starts from.

An operator should be able to work from Codex App, Codex CLI, Claude Code,
OpenCode, Kiln GUI, Kiln TUI, or Kiln CLI and still reach the same governed
Kiln agents, tools, skills, routes, permissions, setup diagnostics, status,
and replay evidence. Harnesses should become interchangeable operator
surfaces, not isolated silos.

The product goal is simple:

```text
Develop Kiln using Kiln, from any supported harness.
```

## Problem Statement

Today, advanced operators hand-write routing doctrine in `AGENTS.md` or
`CLAUDE.md`, install harness-specific plugins, and delegate across harnesses
through shell commands such as `codex exec` or `opencode run`. This works for
experts, but it creates duplicated model-routing policy, unclear authority,
lost status, weak cancellation, incomplete result handoff, and inconsistent
cost control.

The immediate operator pain is quota and cost pressure. Codex-quality routes
are valuable but limited. OpenCode Go and Zen provide cheaper direct-provider
capacity for many delegated tasks, but that capacity is not fully usable from
every harness without manual workarounds. Claude Code subscription access is
also different from Anthropic API access and must not be modeled as a direct
provider unless the operator explicitly supplies API credentials.

Kiln needs to own this boundary natively.

## Goals

- Prefer official cost-efficient direct-provider routes when they are allowed
  and available.
- Use native harness routes only when the product entitlement or terms require
  execution through that harness.
- Expose the same Kiln agents and tools from Codex, Claude Code, OpenCode,
  Kiln GUI, Kiln TUI, and Kiln CLI.
- Preserve authority, setup diagnostics, status, cancellation, result handoff,
  replay, and audit evidence across harness boundaries.
- Reduce duplicated global markdown, local scripts, and plugin-specific
  routing tables.
- Offer optional Kiln built-in instruction profiles without confusing them
  with operator-owned global profiles.
- Make quota-aware and cost-aware delegation a measured control-plane policy
  instead of a prompt convention.

## Scope

- Harness identity, direct-provider identity, native CLI identity, adapter
  identity, and plugin identity.
- Global instruction shims, repo shims, native projections, setup/status, and
  install-state drift.
- Built-in instruction profile catalog, profile adoption, profile provenance,
  and local override semantics.
- Kiln tool exposure inside native harnesses.
- Managed agent invocation across harnesses and providers.
- Direct-provider-first route policy for `codex-oauth`, `opencode-go`, and
  `opencode-zen`.
- Native-harness policy for product entitlements such as Claude Code where the
  subscription is not equivalent to API access.
- Quota, rate-limit, and subscription-economics evidence for route selection.
- Reference implementations and comparative study of Codex, Claude Code,
  OpenCode, and plugins such as `codex-plugin-cc`.

## Non-Goals

- Bypass provider terms, subscription limits, or product boundaries.
- Treat a native CLI login as a generic direct-provider credential.
- Hide cross-harness calls behind shell scripts without status, cancellation,
  or replay evidence.
- Duplicate model rankings or routing policy in generated markdown.
- Treat operator-owned global profiles as if they were built-in Kiln doctrine.
- Promote a provider or harness based on vibes, screenshots, or one-off
  anecdotes.
- Add compatibility shims for obsolete harness configs.
- Create a second agent, tool, permission, or routing owner outside Kiln.

## Sequel Standards

- No legacy hacks.
- No duplicate owners.
- No prompt-only routing policy.
- No hidden fallbacks.
- No dead code.
- No unverified completion claims.
- No unsupported provider or subscription semantics.
- Every cross-harness path must be explainable through contracts, status, and
  replay evidence.

## Research Basis

### Official Provider And Harness Evidence

- OpenAI documents Codex usage with ChatGPT plans and Codex pricing/limits:
  `https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan`
  and `https://developers.openai.com/codex/pricing`.
- OpenAI Codex docs define Codex CLI, config, app server, and global
  instruction loading behavior:
  `https://developers.openai.com/codex/cli/`,
  `https://developers.openai.com/codex/app-server/`, and
  `https://developers.openai.com/codex/guides/agents-md`.
- Anthropic documents Claude Code access through Pro/Max subscriptions, while
  Claude API usage remains a separately billed Console/API product:
  `https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan`
  and
  `https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console`.
- OpenCode documents Go and Zen provider routes with OpenCode API keys,
  subscription or credit economics, and provider IDs:
  `https://opencode.ai/docs/go/`, `https://opencode.ai/docs/zen/`, and
  `https://opencode.ai/docs/providers/`.

### Cloned Harness Evidence

Use cloned sources under `C:/Proyectos/Sequel/cloned` as primary implementation
evidence before designing adapters:

- `cloned/codex` for Codex global instruction loading, config, app server, and
  CLI behavior.
- `cloned/claude-code` for Claude Code instruction and command/plugin
  surfaces.
- `cloned/opencode` for OpenCode rules, providers, global instruction loading,
  and agent behavior.
- `cloned/codex-plugin-cc` for an existing Claude Code to Codex bridge with
  `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`,
  `/codex:status`, `/codex:result`, `/codex:cancel`, and `/codex:setup`.

The plugin is evidence, not the final architecture. It proves demand and
interaction patterns for review, rescue, background jobs, status, cancellation,
and result handoff, but it delegates through the local Codex CLI and inherits
Codex CLI authentication/configuration. Kiln must provide the same workflow
shape through governed routes where possible.

### Current Kiln Evidence

- Global instruction shim projection now owns:
  - `~/.codex/AGENTS.md`
  - `~/.claude/CLAUDE.md`
  - `~/.config/opencode/AGENTS.md`
- Repo shim projection owns:
  - `<repo>/AGENTS.md`
  - `<repo>/CLAUDE.md`
- Config status and setup expose global instruction shim state separately from
  native projections, including canonical shared harness identity.
- Slice 1 closed on 2026-07-11 after controlled verification. The
  runtime-enforced GUI action boundary proves disabled controls are not
  authority, disallowed valid actions never enter CLI mutation services, and
  safe global sync remains subject to CLI unmanaged and drift protections.
- Direct-provider doctrine now states that `codex-oauth`, `opencode-go`, and
  `opencode-zen` are governed by Kiln runtime authority, not native CLI
  permission files.
- Current `sequel-engineering` instruction doctrine is an operator-owned
  global profile under `~/.kiln/instructions`, not a packaged Kiln built-in.
  Kiln has built-in skills today, but built-in instruction profiles remain a
  future product capability.

## Route Policy

### Direct-Provider First

Prefer direct providers when all are true:

- the provider exposes an official route through API key, OAuth, or an
  allowed subscription/entitlement mechanism;
- Kiln can enforce tool admission, authority, working-directory bounds, and
  result capture itself;
- status, cancellation, usage evidence, and replay can be represented in
  shared Kiln contracts;
- the route is cheaper, less quota-sensitive, or more available for the task
  class than a native harness route.

Current direct-provider candidates:

- `codex-oauth` for OpenAI/Codex routes governed by Kiln.
- `opencode-go` for OpenCode Go subscription-backed routes.
- `opencode-zen` for OpenCode Zen credit or free-model routes.

### Native-Harness Required

Use native harness execution when any are true:

- the provider entitlement is available only through the first-party harness
  product;
- using a direct provider would require separate API billing or credentials;
- the native harness exposes a product-specific capability not yet represented
  by Kiln contracts;
- terms, subscription boundaries, or provider policy make direct-provider
  reuse inappropriate.

Current native-harness category:

- Claude Code Pro/Max subscription access is a Claude Code product
  entitlement. Anthropic API/Console access is separately billed. Kiln must not
  model Claude subscription access as a direct Anthropic provider unless the
  operator explicitly configures API credentials and accepts API billing.

## Delivery Slices

### Slice 0 - Boundary And Vocabulary

Status: Complete on 2026-07-13.

Goal: remove ambiguity from harness, provider, adapter, plugin, direct route,
and native route vocabulary.

Work:

- define canonical terms in architecture docs and contracts;
- classify `codex-oauth`, `opencode-go`, `opencode-zen`, Codex CLI, Claude
  Code, OpenCode, and plugin bridges;
- add status fields that distinguish direct-provider availability from native
  harness availability;
- make route diagnostics explain subscription/API/harness boundaries.

Exit gate:

- no status, setup, or route-health surface uses provider and harness
  interchangeably;
- tests cover Anthropic subscription versus API separation.

Closure evidence:

- Canonical vocabulary, direct-provider classification, and the projection
  versus authority boundary now live in
  `docs/architecture/harness-integration-capabilities.md`.
- Native harness permissions are explicitly limited to native-harness routes;
  `codex-oauth`, `opencode-go`, and `opencode-zen` retain Kiln runtime
  authority.
- The smallest admitted Slice 2 sub-slice is a Codex App read-only stdio MCP
  bridge. It exposes canonical status, resolved work-governance policy, and
  Codex capability diagnostics only. Managed-agent invocation remains Slice 3.

### Slice 1 - Global And Repo Projection Parity

Status: Complete on 2026-07-11.

Goal: ensure every harness sees the same canonical Kiln doctrine without
duplicated markdown policy.

Work:

- project global instruction shims into the official user-level entrypoints;
- keep repo shims project-scoped and free of global agent rosters;
- classify unmanaged files, symlinks, drift, stale managed files, and disabled
  harnesses;
- expose global instruction shims through setup/status/uninstall.

Exit gate:

- Codex, Claude Code, and OpenCode global shims are signed, current, and
  independently owned;
- repo `AGENTS.md` and `CLAUDE.md` contain project context, not global rosters;
- setup can show the exact target behind any recommended action.

Closure evidence:

- `packages/cli/src/application/global-instruction-shim-projection.ts` owns
  signed, independently tracked global entrypoints for Codex, Claude Code, and
  OpenCode using shared native install-state, backup, drift, force, and
  uninstall contracts.
- Focused isolated-home CLI tests cover unmanaged adoption/byte-preserving
  backup, managed ownership, drift refusal, explicit force, uninstall, and
  deterministic recreation. The shared setup snapshot carries each global
  shim's target identity, harness-visible target path, status, and canonical
  recommendation; TUI and GUI tests prove those three targets are visible in
  their setup diagnostics without re-evaluating projection policy.
- Repo shim tests prove repository projections specialize inherited doctrine
  without duplicating global doctrine, route policy, or native permission
  state. Direct-provider tests preserve the independence of `codex-oauth`,
  `opencode-go`, and `opencode-zen` from native harness permission files.
- Controlled verification on 2026-07-11 passed three focused one-worker
  repetitions (2 files / 89 tests each), the complete one-worker Core suite
  (272 files / 3,454 tests), and normal `@kilnai/core` testing at the same
  count. The root `bun run typecheck`, `bun run test`, `bun run build`,
  `git diff --check`, and `npx react-doctor@latest --verbose --scope changed`
  gates also passed. Follow-up suite evidence reproduced the broad-glob test's
  sequential 205-file fixture exceeding Vitest's default timeout under
  contention; that fixture now writes the same deterministic files concurrently
  without changing production behavior, assertions, truncation limits, or
  timeouts. The Codex OAuth timing tests remained green and no product defect
  was found.
- Live migration of an operator's real home-directory instruction files remains
  unauthorized and unverified. Isolated-home lifecycle evidence proves the
  ownership contract; it does not authorize mutation of live operator files.

### Slice 1A - Built-In Instruction Profile Catalog

Status: Planned.

Goal: let Kiln offer curated built-in instruction profiles while preserving a
clean boundary between packaged doctrine and operator-owned customization.

Work:

- define a built-in instruction profile registry separate from
  `~/.kiln/instructions`;
- report profile provenance as `builtin`, `global`, or `project` in status and
  setup surfaces;
- support adopting a built-in profile into the operator's global config without
  mutating the packaged source;
- preserve local overrides as explicit operator-owned files;
- prevent built-in profiles from containing volatile provider rankings,
  credentials, route tables, agent rosters, or permission assumptions.

Exit gate:

- `sequel-engineering` or any future packaged profile can be identified as
  built-in versus locally customized;
- setup/status can explain whether a profile is inherited, adopted, overridden,
  stale, or unmanaged;
- generated global and repo shims keep profile provenance clear and do not
  duplicate executable config.

### Slice 2 - Kiln Tool Surface In Native Harnesses

Status: Complete on 2026-07-13.

Goal: make Kiln tools available from supported harnesses through governed
adapters instead of shell workarounds.

Work:

- define which Kiln tools can be exposed inside Codex, Claude Code, and
  OpenCode;
- map each tool to read/write authority, approval requirements, and session
  scope;
- provide status diagnostics for missing plugin/MCP/app-server capability;
- prevent native harnesses from self-granting broader Kiln authority.

Exit gate:

- Codex App or Codex CLI can inspect Kiln config/status through a governed
  tool surface;
- unavailable tools fail closed with actionable diagnostics.

Current evidence: `.codex/config.toml` declares the dedicated Kiln stdio MCP
adapter for trusted workspaces. Isolated protocol tests cover discovery,
canonical query mapping, malformed input, unavailable and incomplete evidence,
mutation denial, deterministic serialization, secret-safe projection, and no
CLI subprocess route. Codex App discovery still requires existing Codex project
trust and an operator restart when the app has an already-active thread; this
task does not mutate Codex home configuration or claim a live discovery event.

The first live Codex App invocation exposed an adapter defect: the read-only
query treated unrelated stale or drifted projections as a complete status
acquisition failure. The recovery preserves degraded status and observed
capability envelopes, makes project discovery independent of the process CWD,
and validates evidence version, freshness, shape, and resolved governance at
the canonical status-projection boundary. Governance remains fail-closed when
its canonical policy evidence is missing or malformed.

Implementation closed in `e2f925c1` and `2804e757`. Live Codex App acceptance
on 2026-07-13 passed: all three project-local tools — `kiln_status_inspect`,
`kiln_work_governance_inspect`, and `kiln_capability_inspect` — were discovered
and invoked without `KILN_STATUS_EVIDENCE_INCOMPLETE`. The observed harness was
`native-harness / codex / app` through `kiln-codex-app-mcp`; request IDs
`codex-app-mcp-6` through `codex-app-mcp-8` were observed from
`2026-07-13T20:29:09.330Z` to `2026-07-13T20:29:09.548Z`.

- Status returned a useful degraded envelope with
  `review-native-projection-drift` and `sync-global-instruction-shims`.
- Governance returned `authority: authoritative` from `kiln-config-status`.
- Capability returned `availability: available`, `mcpRuntimeTools: supported`,
  and `bridgeProjection: current` from
  `kiln-harness-integration-capabilities`.
- Unrelated stale or drifted projections did not invalidate the directly
  observed bridge capability. Diagnostics remained
  `KILN_PROJECTION_STALE` and `KILN_PROJECTION_DRIFTED`.
- The live envelopes exposed no paths, raw configuration, environment data,
  credentials, secrets, exceptions, or stack traces.

### Slice 3 - Managed Agent Invocation Across Harnesses

Status: Slice 3A and Slice 3B are implemented with a corrected Slice 3B
selection contract. Slice 3B awaits one bounded real Codex App/OpenCode Go
acceptance; full Slice 3 remains incomplete.

Goal: allow admitted harness surfaces to invoke Kiln-managed agents through
canonical routes without giving a harness ownership of managed-job state.

Work:

- Implement only a Codex App → Kiln → OpenCode Go managed-agent invocation
  that returns the canonical managed job identifier and status evidence. Do
  not add cancellation, result fetch, replay, Claude adapters, or a second
  provider route in this slice.
- expose `managed_agent.invoke` or equivalent through harness adapters;
- support background job ids, status, cancellation, result fetch, and replay
  references;
- preserve route identity, authority profile, work-item scope, timeout source,
  and parent-turn lineage;
- prevent direct shell delegation from becoming the default cross-harness path.

Exit gate:

- from Codex App, an operator can invoke an OpenCode Go route through Kiln and
  receive status/result evidence without running `opencode run`;
- from Claude Code, an operator can invoke a Codex route through Kiln without
  relying on `codex-plugin-cc` as the authority owner.

#### Slice 3A Closeout

Slice 3A provides only the Runtime-owned persistent managed-job application
boundary. It validates a trusted project identity and fresh authoritative
governance, resolves configured profile/route evidence through injected ports,
binds opaque job identity and idempotency, and recovers nonterminal work as
interrupted after restart. It adds no MCP tool, harness adapter, shell execution,
or provider adapter.

The only admitted successor is Slice 3B: a thin Codex App MCP adapter that
projects submit/status through this owner. It must not duplicate admission,
routing, persistence, lifecycle, or provider execution.

#### Slice 3B Closeout

The project-local Codex App adapter now projects exactly two managed-job
operations: `kiln_managed_agent_invoke` and `kiln_managed_agent_status`.
Production composition keeps the application owner, persistent store,
governance, configured-agent/route resolution, Runtime invocation bridge,
and direct-provider adapter outside the MCP presentation layer. The admitted
configuration boundary restricts this vertical slice to `opencode-go`.

The implementation has deterministic adapter/application coverage and isolated
stdio proofs from repository and unrelated working directories. It awaits one
bounded live acceptance only: restart Codex App and perform one managed-agent
invocation through the new MCP surface. No result, cancellation, listing,
configuration mutation, or provider/model selection is admitted by this slice.

Managed-agent admission profiles are operator-configured route policy, not
packaged built-ins. Codex App refreshes provider-model eligibility through the
canonical staged route catalog synchronously during MCP startup before composing
the managed-job application; this is provider metadata/eligibility discovery,
not managed inference or job execution. The MCP adapter only projects that
result and never selects a route itself. One pre-fix focused test accidentally
used this default discovery before it was replaced with an injected local
catalog; it may have performed metadata/eligibility discovery, but it could not
have created a managed job or consumed billable inference.
Configured agents and admission profiles are distinct identities. The caller
requests a configured agent; the canonical catalog supplies that agent's route
hint; the resolved route supplies and validates its admission profile. Slice 3
intentionally admits the read-only planning profile only, and only when that
profile is supplied by the hinted route. Multiple
routes sharing an admission profile are valid. Capability inspection exposes a
redacted configured-agent summary with identity, optional role/display name,
availability, provider family, admission profile, and stable diagnostic/action.
It never exposes route configuration, models, paths, credentials, permissions,
configuration, or provider payloads. The Slice 3B live blocker was therefore a
selection-contract defect, not invalid operator configuration: the former
profile-only rule incorrectly required a global one-route binding. The repair
uses the configured-agent hint and leaves full Slice 3 pending until corrected
live acceptance passes. Slice 4 routing is not started.

### Slice 4 - Quota And Subscription-Aware Routing

Status: Planned.

Goal: spend scarce quota only where it improves verified outcomes.

Work:

- record route quota class, subscription class, metered cost class, and
  comparable-cost status;
- model `opencode-go` and `opencode-zen` as preferred low-cost delegated
  routes when task fit is adequate;
- reserve expensive or scarce routes for tasks whose evidence says they need
  them;
- add operator-configurable ceilings and fail-closed behavior when usage
  evidence is unavailable.

Exit gate:

- route choice can explain why it used Codex quota instead of OpenCode, or the
  reverse;
- no route claims free execution without evidence of subscription economics.

### Slice 5 - Native Harness Entitlement Adapters

Status: Planned.

Goal: support product-entitlement routes where direct providers are not
appropriate.

Work:

- model Claude Code subscription access as native-harness entitlement, not a
  direct Anthropic provider;
- define what proof Claude Code can provide for execution, result handoff, and
  authority;
- isolate API-key Anthropic usage as a separate explicitly billed direct
  provider only when configured;
- document terms and billing boundaries in status.

Exit gate:

- Claude Code subscription and Anthropic API usage cannot be confused in route
  selection or status;
- native-harness routes expose unsupported-proof diagnostics where Kiln cannot
  verify behavior.

### Slice 6 - Plugin And Adapter Reference Implementations

Status: Planned.

Goal: use real harness/plugin patterns without copying their limitations into
Kiln architecture.

Work:

- study `codex-plugin-cc` review/rescue/status/result/cancel/setup flows;
- compare Codex app server, Claude Code commands/plugins, OpenCode rules, MCP,
  and native agent formats;
- implement the thinnest adapter needed for each harness surface;
- keep adapter code behind stable Kiln contracts.

Exit gate:

- a plugin or adapter can be removed without changing canonical route policy;
- background job lifecycle is represented in Kiln events, not plugin-local
  prose.

### Slice 7 - Cross-Harness Setup And Doctor

Status: Planned.

Goal: make setup state obvious and repairable from any supported surface.

Work:

- unify setup status for global shims, repo shims, native projections, plugins,
  MCP servers, auth, app servers, and managed route health;
- add repair actions only where Kiln owns the lifecycle;
- keep review-only or drift-sensitive actions blocked until the operator
  explicitly reviews them.

Exit gate:

- `kiln status` can explain why a harness cannot see Kiln tools or agents;
- setup recommendations include target snapshots, not only action strings.

### Slice 8 - Dogfood Gate

Status: Planned.

Goal: develop Kiln from Codex App using Kiln tools and low-cost delegated
routes.

Work:

- run a real Kiln development slice from Codex App;
- use Kiln tools for setup/status/config inspection;
- delegate at least one implementation or research task to `opencode-go` or
  `opencode-zen` through Kiln managed invocation;
- preserve status, cancellation, result, and replay evidence.

Exit gate:

- the operator can work primarily from Codex App without burning Codex quota
  for every delegated task;
- the workflow does not call `opencode run` or `codex exec` as a hidden
  workaround for a Kiln-managed route.

### Slice 9 - Cross-Harness Benchmarks

Status: Planned.

Goal: replace anecdotal model-routing tables with measured task-class policy.

Work:

- compare direct providers and native harnesses on representative Kiln tasks;
- report verified success, latency, quota pressure, cost class, retries,
  operator intervention, and residual risk;
- separate UI/computer-use verification, code implementation, research,
  review, mechanical edits, and long-running debugging.

Exit gate:

- route defaults are justified by reproducible evidence;
- any public claim discloses provider dependencies, subscription assumptions,
  and unsupported proof gaps.

## Promotion Gates

A slice may close only when:

1. The owning contract and boundary are documented.
2. Tests cover direct-provider versus native-harness separation.
3. Setup/status expose target-specific evidence.
4. Authority and permission semantics fail closed.
5. Cross-harness jobs carry status, cancellation, result, and replay evidence.
6. Provider terms and subscription/API billing assumptions are documented.
7. Focused tests, typecheck, and relevant integration checks pass.
8. Residual risks and unsupported proof gaps are recorded.

## Verification

Required verification scales by slice:

- focused CLI/runtime/gateway-contract tests for contract changes;
- isolated-home projection tests for global and repo shims;
- native harness fixture tests using cloned Codex, Claude Code, OpenCode, and
  `codex-plugin-cc` behavior;
- live opt-in smoke tests only when credentials, quota, and subscription
  effects are explicitly authorized;
- `bun run typecheck`;
- `bun run test` for affected packages;
- `git diff --check`;
- reviewer and adversarial-review gates for route/authority changes.

## Completion Criteria

This roadmap is complete when a supported harness can act as an entrypoint into
Kiln rather than a silo:

- Codex App can use Kiln tools and agents.
- Claude Code can use Kiln-managed Codex/OpenCode routes without owning routing
  policy in `CLAUDE.md`.
- OpenCode can see the same Kiln doctrine and delegated route capability.
- Direct providers are preferred where official, cheaper, and governed.
- Native harnesses are used where product entitlements or terms require them.
- Setup, status, cancellation, result handoff, authority, replay, and cost
  evidence remain consistent across surfaces.
