# 07 - Cross-Harness Provider Adapter Layer

Status: Urgent active adapter-layer roadmap
Started: 2026-06-29

## Objective

Make cross-harness provider and agent execution explicit, governed, and
diagnosable without projecting unsupported model strings into native harness
files.

## Problem

Kiln can define canonical agents, routes, tools, skills, memory, governance,
and native projections across Codex, OpenCode, and Claude Code. Live validation
showed a hard boundary: native harness agent files cannot safely carry provider
or model identifiers that the target harness does not understand. Codex rejects
OpenCode-qualified models, and OpenCode requires its own provider/model
encoding. Treating those strings as portable creates invalid native profiles,
runtime admission failures, and confusing live-test behavior.

The immediate native-projection fix is correct but incomplete. It prevents
false native support by omitting incompatible strict `providerRoute` pins from
native harness files. The product goal remains larger: Kiln should let an
operator work from one surface and still use governed agents, tools, and
provider routes backed by another harness or provider when Kiln has explicit
adapter capability.

## Urgency

This is urgent because the current safe behavior avoids crashes by reducing
native visibility. From a Codex-native session, OpenCode-pinned agents are no
longer projected as Codex subagents. That is the right fail-closed behavior,
but it leaves a core product promise unfinished:

- operators should not need to understand which harness owns each model;
- non-programmer users should see a coherent team, not fragmented native
  harness rosters;
- managed agents should be routed by Kiln capabilities and authority, not by
  brittle native model strings;
- cross-surface live tests need a supported path for Codex parent sessions to
  invoke OpenCode-backed work through Kiln.

## Research Basis

The design is grounded in the research and live validation completed before
this roadmap item:

- Provider and harness documentation show that model ids are not universally
  portable. Native harnesses accept model identifiers through their own
  provider registries, config files, or runtime adapters.
- Community adapter patterns show that cross-provider execution is possible,
  but only when a plugin, provider adapter, MCP bridge, or proxy explicitly
  translates requests and owns the runtime boundary.
- Cloned harness repositories showed mature harnesses treat tools, providers,
  approvals, resources, and session evidence as explicit integration surfaces
  rather than hidden string fallbacks.
- Kiln live tests confirmed that blind native projection of provider-qualified
  model strings causes admission failures in Codex App and confusing GUI
  behavior.
- Kiln's existing managed-agent runtime already has the right primitives:
  route identity, provider/model discovery, authority profiles, tool policy,
  transcript evidence, work-governance state, and resource-backed diagnostics.

No local cloned repository paths belong in this roadmap. The evidence should be
recorded by source category, durable docs, and reproducible behavior, not by
developer-specific filesystem locations.

## Desired Capability

Kiln should become the explicit cross-harness provider and agent adapter layer.
The target behavior is:

1. A parent session in Codex, OpenCode, Claude Code, GUI, TUI, CLI, or a future
   remote surface can request a governed Kiln agent.
2. Kiln resolves the request through canonical agent config, task affinity,
   work governance, route policy, provider/model discovery, and authority.
3. If the selected route is native to the current harness, Kiln may project or
   invoke it through the native capability.
4. If the selected route belongs to another harness or provider, Kiln invokes
   it through an explicit adapter capability.
5. The parent receives a structured result with route identity, provider/model,
   authority, tools used, transcript/resource links, and residual-risk
   evidence.

This must not be implemented by projecting unsupported model strings into
native files.

## Goals

- Let a parent session invoke governed Kiln agents through native or adapter
  capabilities based on explicit route support.
- Preserve route identity, authority, tool policy, transcript evidence, and
  residual-risk reporting across harness boundaries.
- Keep native projection fail-closed for unsupported provider/model strings.
- Give non-programmer operators a coherent team view without hiding harness
  limitations.

## Scope

The first implementation track should introduce:

- a capability registry that distinguishes native support, adapter support, and
  unsupported routes;
- adapter declarations for provider/harness bridges without string-prefix
  guessing;
- a model-facing invocation surface that lets native Codex or other harness
  sessions call Kiln-managed agents backed by OpenCode, Codex OAuth,
  OpenRouter, or future providers;
- setup/status diagnostics that show whether a cross-harness adapter is
  installed, enabled, authenticated, and admitted;
- tests proving that incompatible native projection remains omitted unless an
  explicit adapter capability exists;
- live tests proving Codex parent -> Kiln -> OpenCode-backed read-only child
  execution end to end.

## Non-Goals

- Do not reintroduce top-level agent `model`.
- Do not project `opencode-go/...` into Codex native agent files unless Codex
  has an explicit Kiln adapter/provider capability that makes that id valid.
- Do not add fallback providers to hide unsupported routes.
- Do not bypass work governance, authority profiles, install-state, or
  transcript evidence.
- Do not create harness-specific hacks that cannot be represented in shared
  capability/status contracts.

## Sequel Standards

- No fallback providers to hide unsupported routes.
- No string-prefix guessing as a routing contract.
- No bypass of work governance, authority, install state, or transcript
  evidence.
- No native projection of incompatible route identifiers without an explicit
  adapter/provider capability.

## Architecture Direction

The adapter layer should sit between canonical Kiln routes and harness-native
execution:

```text
Kiln agent profile
  -> providerRoute / task affinity / work governance
  -> capability resolver
     -> native harness support
     -> installed Kiln adapter support
     -> unsupported
  -> managed invocation runtime
  -> transcript, resources, evidence, and result handoff
```

Native projection remains a standalone-harness artifact strategy. It should not
be the cross-harness execution mechanism. Cross-harness execution belongs in
the managed invocation/runtime adapter layer because that layer can enforce
authority, discovery, budget, lifecycle, and evidence.

## Promotion Gates

- `kiln config read agents` and setup/status views identify native, adapter,
  and omitted agent projection or invocation paths.
- A Codex parent session can invoke one OpenCode-backed read-only Kiln agent
  through a governed tool or adapter path without the OpenCode agent appearing
  as an invalid Codex native subagent.
- The invocation result records the real route id, provider id, model,
  authority profile, tool policy, tool events, transcript/resource evidence,
  and final outcome.
- Unsupported adapter paths fail closed with a clear capability diagnostic.
- Tests cover native support, adapter support, unsupported routes, drift-safe
  cleanup of obsolete native files, and setup/status reporting.
- Documentation explains the difference between native projection,
  managed-agent invocation, and cross-harness adapters for non-programmer
  operators.

## Verification

- Contract tests cover native support, adapter support, unsupported routes,
  drift-safe cleanup, and setup/status reporting.
- A local live read-only proof demonstrates Codex OAuth parent -> Kiln managed
  invocation -> OpenCode-backed child -> structured handoff.
- Documentation distinguishes native projection, managed-agent invocation, and
  cross-harness adapters.

## Dependencies

- `docs/architecture/harness-integration-capabilities.md`
- `docs/architecture/managed-agents.md`
- `docs/architecture/provider-model-discovery.md`
- `docs/architecture/config-projection.md`
- `docs/guides/global-config.md`
- `docs/research/20-cross-domain-task-taxonomy.md`

## Delivery Slices

### Slice 1 - Read-Only Cross-Harness Bridge

Start with a read-only vertical slice:

1. Add adapter capability types and status reporting.
2. Expose a Codex-parent-safe model-facing path to invoke a Kiln managed agent
   backed by an OpenCode read-only route.
3. Prove the path with one local live test:
   Codex OAuth parent -> Kiln managed invocation -> OpenCode-backed read-only
   scout/researcher -> structured handoff.
4. Keep native projection fail-closed for unsupported provider/model strings.

This slice should not include write authority, background fan-out, or remote
harness adapters. Those belong after the read-only bridge is proven.

## Completion Criteria

This roadmap closes when cross-harness agent invocation is represented by
shared capability/status contracts, verified through a read-only adapter path,
and no unsupported provider/model string is projected into a native harness
file.
