# Changelog

This changelog tracks supported public changes beginning with the Kiln 2.0
baseline. Active and deferred execution tracks live in
[`docs/roadmap/`](roadmap/README.md); stable doctrine lives in
[`docs/architecture/`](architecture/README.md); curated release notes live in
[`docs/releases/`](releases/README.md).

## v2.1.0

- Completed the execution-surfaces convergence track: shared Operator
  Workspace home projection, gateway target switcher, target-aware resource
  inspector reads through runtime provider options, SDK `ApiClient.readResource`,
  CLI target-aware resource reads, and stable architecture/guide documentation.
- Replaced internal tool annotation authority with canonical action-effect
  governance: builtin tools now declare immutable effect envelopes, concrete
  calls resolve input-sensitive invocation effects before authority, external
  MCP hints remain untrusted presentation metadata, fallback tools authorize
  independently, and runtime evidence records resolved effect plus authority.
- Persisted terminal `agent_invocation_*` events for background
  `managed_agent.start` children as soon as runtime finalization completes, so
  GUI/TUI transcripts and replay no longer depend on a later join or cancel
  control to close naturally completed child work. Terminalized startup
  failures after runtime-owned lease side effects now record the same canonical
  requested, started, and failed events.
- Kept direct-provider managed child result handoffs bounded while preserving
  long final child output as governed replay resources, projected through
  managed-agent or artifact resource URIs instead of inline session metadata.
- Preserved persisted GUI/TUI turn identity through executable runtime
  per-call config so managed children record the correct parent turn, made
  `managed_agent.join` return successful terminal observations for cancelled
  or other non-completed children, exposed terminal handoff/resource evidence
  in model-visible join output, and added managed-route timeout source
  diagnostics.
- Raised synthesized managed-agent route timeouts to five minutes, projected
  route timeout budgets into the model-facing managed-agent catalog, made
  CLI-harness timeout handoffs name the admitted timeout and replay resources,
  clarified `contextMode: "resources"` versus child `resource_read` authority,
  and made successful `managed_agent.cancel` controls report accepted terminal
  cancellation evidence instead of a failed tool result.
- Made paginated `resource_read` continuations model-visible with a trailing
  JSON control block, and kept GUI/TUI managed invocation lifecycle tools bound
  to the stable outer Kiln session across recreated provider turns.
- Made `kiln managed-agent` replay recover GUI/TUI managed-child cockpit state
  from persisted managed tool-completion evidence and list snapshots when
  canonical `agent_invocation_*` events were absent or only partially persisted
  through the shared gateway-contract normalizer, returned managed transcript
  resources as bounded `text/markdown` bodies, and shared managed child
  `contextMode: "resources"` context construction across direct-provider and
  CLI-harness adapters, with terminal list snapshots kept provisional until
  richer terminal tool evidence arrives and join evidence allowed to complete
  canonical-start-only streams.
- Projected adapter-private managed invocation evidence pointers into public
  managed-agent or artifact resource URIs before they cross GUI, TUI, CLI,
  replay, or model-facing `resource_read` surfaces, including nonterminal
  start metadata and TUI per-turn resource reads. Direct-provider and
  CLI-harness managed children now hydrate admitted resource context from the
  current session-scoped builtin tool surface instead of the
  route-construction-time surface.
- Promoted the background and parallel managed-agent track into stable
  architecture docs, including runtime-owned child lifecycle, parallel
  orchestration admission, resource leases, cross-surface cockpit projection,
  artifact-backed resource pagination, runtime budget admission, and remote
  harness route constraints.
- Published `@kilnai/gui` as a public static asset package.
- Made `@kilnai/cli` the public global install boundary for CLI, GUI, TUI,
  runtime, gateway contracts, and GUI assets.
- Added deterministic `kiln run --output answer|json` contracts and kept
  `kiln benchmark run-internal` stdout machine-readable for exact-format eval
  and benchmark harnesses.
- Moved runtime-owned GUI serving to the installed `@kilnai/gui` package and
  removed source-tree GUI discovery from production startup.
- Made `kiln gui` production mode the default from any working directory;
  `--dev` is now explicitly for source-tree GUI development.
- Promoted runtime and TUI internal package imports to direct package
  dependencies instead of peer-only runtime requirements.
- Added `@kilnai/gui` to the npm publish graph before runtime and CLI publish.
- Clarified that Native remains source-only experimental work in this release.

## v2.0.0

- Prepared the workspace for the `2.0.0` public baseline.
- Bumped public and private workspace package metadata to `2.0.0`.
- Aligned internal `@kilnai/*` peer and optional dependency ranges to the
  `2.0.0` package line.
- Kept reserved developer-tool platform packages private until Kiln ships
  actual vendored binaries.
- Reset curated release notes so `docs/releases/` starts at the supported
  `2.0.0` baseline.
- Restricted npm publishing to `v2.*` tags and added tag/package version
  validation before publish.
- Added `@kilnai/gateway-contracts` to the publish graph so public packages do
  not depend on an unpublished workspace package.

Kiln 2.0.0 is the first supported public baseline for the current
biocybernetic control-plane architecture.

### Verification

Release verification:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```
