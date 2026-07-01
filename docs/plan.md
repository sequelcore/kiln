# Trusted Execution and Native Permission Integrity Plan

Status: Active implementation plan
Updated: 2026-07-01

## Objective

Deliver one provider-neutral, evidence-based permission integrity model that
separates desired policy, persisted native projection, active session override,
observed runtime authority, harness enforcement capability, and operator-local
authorization. Codex, Claude Code, and OpenCode adapters must report semantic
loss honestly; managed background execution must fail closed when required
authority is unproven; every operator and model-readable surface must render the
same Gateway contract.

## Non-Goals and Safety Boundaries

- Do not make a session-only override persistent or canonical.
- Do not treat a UI selection, model statement, stale observation, or native
  `allow` setting as proof of effective runtime authority.
- Do not represent OpenCode permission resolution as sandbox enforcement.
- Do not broaden personal authority from repository configuration.
- Do not overwrite drifted managed native fields outside the existing governed
  proposal, approval, and apply lifecycle.
- Do not repair configuration from `kiln doctor`; doctor stays read-only.
- Do not add dependencies, compatibility shims, duplicated surface policy, or
  live paid/credentialed probes to satisfy this plan.
- Preserve existing uncommitted generated `AGENTS.md` and `CLAUDE.md` changes;
  never hand-edit or stage them with these slices.

## Settled Architecture

1. `@kilnai/gateway-contracts` owns the serialized
   `TrustedExecutionIntegrity` contract: permission intent, evidence, freshness,
   enforcement capability, operator authorization, classification,
   recommendation, and approval requirement.
2. `@kilnai/core` owns pure comparison/classification and trust-boundary
   invariants. It accepts evidence; it performs no filesystem or process reads.
3. `@kilnai/cli` owns native harness adapters and collection of canonical,
   persisted, session, and observed runtime evidence. Translation is
   capability-aware and returns unsupported/lossy evidence.
4. `@kilnai/runtime` owns child requested/projected/observed authority evidence
   and fail-closed unattended/background admission. Parent authority is never
   assumed to propagate.
5. CLI, GUI, TUI, setup/status, doctor, and model-callable config reads consume
   the shared status contract. Surfaces render recommendations; they do not
   classify policy locally.
6. The required classifications are `current-verified`,
   `intentional-operator-override`, `native-projection-drift`,
   `runtime-policy-mismatch`, `effective-policy-unproven`,
   `unsupported-semantic-translation`, `dangerous-unapproved-broadening`,
   `stale-evidence`, `partial-observation`, and `observation-failed`.

## Roadmap Ownership

Create `docs/roadmap/05-trusted-execution-integrity.md` when Slice 1 begins and
add it to `docs/roadmap/README.md` as an active security/configuration track.
Update its completed-slice evidence after every implementation commit. Keep
`docs/roadmap/03-federated-harness-configuration-plane.md` deferred and intact:
that roadmap concerns a broader future configuration plane, while this plan
closes a current correctness and authority-integrity defect.

Do not delete roadmap 05 until all implementation commits, full verification,
independent reviews, canonical documentation promotion, changelog entry, and
stale-reference scans pass. Then remove it and retain history in
`docs/changelog.md`.

## Slice 1 - Contract, Domain Model, and Evidence Taxonomy

Commit: `feat(config): model effective permission evidence`

### Ownership and files

- Add the serialized contract and Zod schemas in
  `packages/gateway-contracts/src/config-status.ts`; export through
  `packages/gateway-contracts/src/index.ts` if required.
- Add contract parsing/round-trip tests in
  `packages/gateway-contracts/tests/config-status.test.ts`.
- Add pure domain policy in
  `packages/core/src/security/trusted-execution-integrity.ts` and export it from
  `packages/core/src/security/index.ts`.
- Add classification and trust-boundary tests in
  `packages/core/tests/security/trusted-execution-integrity.test.ts`.
- Create/update `docs/roadmap/05-trusted-execution-integrity.md` and
  `docs/roadmap/README.md` with slice state only; durable doctrine waits for
  Slice 5.

The contract must represent desired, persisted, session, and effective evidence
separately, including source, observed/verified timestamps, freshness,
proof status (`proven`, `inferred`, `unavailable`, `contradictory`), projection
ownership, operator authorization, enforcement capability/strength, semantic
loss, classification, exact action, and whether remediation requires approval.

Repository-owned input may narrow authority but cannot authorize or broaden an
operator-local trusted profile. Dangerous broadening outranks an intentional
override; stale evidence cannot yield `current-verified`.

### TDD and gates

Red:

```bash
bun run --cwd packages/gateway-contracts test -- tests/config-status.test.ts
bun run --cwd packages/core test -- tests/security/trusted-execution-integrity.test.ts
```

Confirm failures are missing contract/classifier behavior, then implement the
minimum coherent model. Green and package gates:

```bash
bun run --cwd packages/gateway-contracts test -- tests/config-status.test.ts
bun run --cwd packages/core test -- tests/security/trusted-execution-integrity.test.ts
bun run --filter @kilnai/gateway-contracts test
bun run --filter @kilnai/core test
bun run typecheck
git diff --check
```

Review gates: clean-architecture boundary review, security-scope review, and
code quality review. Do not commit until blocking findings are resolved.

Rollback: revert this commit before later slices; no persisted format is written
yet. Residual risk: classification precedence errors, mitigated by exhaustive
table tests for every required classification and contradictory evidence.

## Slice 2 - Harness Adapters and Native Projection Semantics

Commit: `fix(projection): distinguish trusted overrides from native drift`

### Ownership and files

- Extend adapter output in
  `packages/cli/src/config/translators/permission-projection.ts`,
  `claude-translator.ts`, `codex-translator.ts`, and `opencode-translator.ts`.
- Collect persisted/session/runtime evidence and preserve ownership in
  `packages/cli/src/config/native-permission-projection.ts`,
  `packages/cli/src/config/native-projection-state.ts`, and
  `packages/cli/src/application/config-status.ts`.
- If runtime evidence enters through process wrappers, adapt only the existing
  boundaries in `packages/cli/src/wrapper/codex-session.ts`,
  `claude-code-process.ts`, `opencode-session.ts`, and `session.ts`; do not parse
  UI labels as proof.
- Extend focused tests in
  `packages/cli/tests/config/translators/permission-translators.test.ts`,
  `packages/cli/tests/config/native-permission-projection.test.ts`,
  `packages/cli/tests/config/native-projection-state.test.ts`, and
  `packages/cli/tests/application/config-status.test.ts`.
- Add wrapper regression tests only where an observable session evidence port
  exists: `packages/cli/tests/wrapper/codex-session.test.ts`,
  `opencode-session.test.ts`, and the existing Claude process tests.

Codex translation must distinguish persisted `approval_policy`/`sandbox_mode`
from Desktop session overrides and effective observations. Claude Code mapping
must retain the differences among `auto`, `dontAsk`, and
`bypassPermissions`. OpenCode `allow`/`ask`/`deny` must report permission-rule
resolution without claiming filesystem sandbox strength. Unsupported or lossy
translation fails closed with actionable evidence.

Projection remains managed-field-only, preserves unmanaged native fields,
refuses unapproved drift overwrite, and is idempotent. An explicitly authorized
operator-local trusted override is not unexplained native drift; it may still be
unproven or contradictory at runtime.

### TDD and gates

Red tests must cover: selected Full Access with narrower/omitted native config;
effective `workspace-write` despite Full Access selection; approved trusted
override; repository broadening attempt; OpenCode enforcement honesty;
unmanaged-field preservation; repeated projection; unsupported translation;
and explicit approval for remediation.

```bash
bun run --cwd packages/cli test -- tests/config/translators/permission-translators.test.ts
bun run --cwd packages/cli test -- tests/config/native-permission-projection.test.ts tests/config/native-projection-state.test.ts
bun run --cwd packages/cli test -- tests/application/config-status.test.ts
```

After expected red failures, implement and run:

```bash
bun run --cwd packages/cli test -- tests/config/translators/permission-translators.test.ts
bun run --cwd packages/cli test -- tests/config/native-permission-projection.test.ts tests/config/native-projection-state.test.ts
bun run --cwd packages/cli test -- tests/application/config-status.test.ts
bun run --filter @kilnai/cli test
bun run typecheck
git diff --check
```

Review gates: config-projection ownership review, security-scope review, and
adversarial stale/contradictory evidence review.

Rollback: revert adapter commit; existing install-state files remain readable
unless their schema changes. If install-state serialization changes, make the
reader fail closed on unknown shape and document the rollback procedure before
commit. Residual risk: harnesses may not expose runtime evidence; represent this
as unavailable/unproven rather than inventing parity.

## Slice 3 - Runtime and Managed-Agent Authority Evidence

Commit: `feat(runtime): enforce managed agent authority evidence`

### Ownership and files

- Add requested/projected/observed authority fields to the canonical managed
  invocation contract in the existing owner under
  `packages/core/src/agents/managed-invocation/` (principally
  `orchestration.ts` and `index.ts`) and its tests under
  `packages/core/tests/agents/managed-invocation/`.
- Propagate and compare evidence in
  `packages/runtime/src/agents/managed-invocation/cli-harness-adapter.ts`,
  `direct-runtime-adapter.ts`, `remote-harness-adapter.ts`, `fan-out.ts`, and
  the invocation admission/service owner found in that directory.
- Reuse the shared integrity classifier; do not duplicate permission semantics
  in adapters.
- Extend
  `packages/runtime/tests/managed-agent/opencode-cli-harness-adapter.test.ts`,
  `direct-runtime-adapter.test.ts`, `remote-harness-adapter.test.ts`,
  `fan-out-lifecycle.test.ts`, `invocation-service.test.ts`, and
  `packages/runtime/tests/session/managed-invocation-session-events.test.ts`.

Unattended/background execution that requires trusted authority must fail before
dispatch when observed child authority is absent, stale, unsupported,
contradictory, or narrower than required. The failure must identify requested,
projected, and observed states and the exact operator action. Resume,
compaction, automation, fan-out, native child, and cross-harness child paths
must never assume inheritance from the parent.

### TDD and gates

Red:

```bash
bun run --cwd packages/core test -- tests/agents/managed-invocation
bun run --cwd packages/runtime test -- tests/managed-agent/invocation-service.test.ts tests/managed-agent/opencode-cli-harness-adapter.test.ts tests/managed-agent/direct-runtime-adapter.test.ts tests/managed-agent/remote-harness-adapter.test.ts tests/managed-agent/fan-out-lifecycle.test.ts
bun run --cwd packages/runtime test -- tests/session/managed-invocation-session-events.test.ts
```

Tests must prove child downgrade/unproven inheritance diagnostics and lost Full
Access after resume, compaction, automation, or child invocation. Green:

```bash
bun run --cwd packages/core test -- tests/agents/managed-invocation
bun run --cwd packages/runtime test -- tests/managed-agent tests/session/managed-invocation-session-events.test.ts
bun run --filter @kilnai/core test
bun run --filter @kilnai/runtime test
bun run typecheck
git diff --check
```

Do not run credentialed `*.live.test.ts` suites without separate operator
authorization; deterministic adapter tests are required regardless.

Review gates: managed-agent risk review (inheritance, replay, route identity,
fail-closed admission), security-scope review, clean-architecture boundary
review, and code quality review.

Rollback: revert runtime and contract commit together. Residual risk: providers
that expose no child runtime policy remain unavailable/unproven and therefore
cannot satisfy trusted unattended admission.

## Slice 4 - Doctor and Shared Operator Projections

Commit: `feat(operator): expose effective permission integrity`

### Ownership and files

- Attach integrity to `KilnConfigStatusSnapshot` and config-read views in
  `packages/gateway-contracts/src/config-status.ts` and their contract tests.
- Populate it once in `packages/cli/src/application/config-status.ts`; keep
  setup mutations in `config-setup-actions.ts` approval-gated.
- Render it in existing CLI config/status/doctor owners under
  `packages/cli/src/commands/` and `packages/cli/src/formatters.ts`.
- Extend model-callable reads in
  `packages/cli/tests/application/config-read-tool.test.ts` through the existing
  config-read implementation; no model-facing mutation tool is added.
- Project the same Gateway payload through runtime routes/controllers and render
  it in existing GUI and TUI config/setup/status components discovered during
  implementation. Expected owners are the config/setup Gateway handler under
  `packages/runtime/src/gateway/`, GUI config/setup panels under
  `packages/gui/src/`, and TUI handlers/renderers under `packages/tui/src/`.
  Record exact discovered paths in roadmap 05 before editing; do not create a
  parallel status service.
- Add parity tests in `packages/cli/tests/commands/config.test.ts`,
  `packages/cli/tests/application/config-read-tool.test.ts`, relevant runtime
  Gateway tests, GUI component/parity tests, and TUI handler/render tests.

Every surface reports desired canonical policy, persisted native policy,
effective observed runtime policy when available, source/freshness,
enforcement capability, selected-versus-effective status, classification,
exact action, and approval requirement. Doctor obtains evidence only and makes
no writes.

### TDD and gates

Add failing contract/parity tests first, including a filesystem spy proving
doctor makes no writes and a UI Full Access/effective workspace-write mismatch.

```bash
bun run --cwd packages/cli test -- tests/commands/config.test.ts tests/application/config-read-tool.test.ts
bun run --cwd packages/runtime test -- tests/gateway
bun run --cwd packages/gui test
bun run --cwd packages/tui test
```

After implementation:

```bash
bun run --filter @kilnai/gateway-contracts test
bun run --filter @kilnai/cli test
bun run --filter @kilnai/runtime test
bun run --filter @kilnai/gui test
bun run --filter @kilnai/tui test
bun run typecheck
bun run --cwd packages/gui test:e2e
git diff --check
```

Start the applicable local GUI dev server and validate the permission integrity
status in a browser before closure; record the command, browser scenario, and
result in roadmap 05. Do not use credentials or live provider calls.

Review gates: cross-surface contract parity, React/TypeScript review for GUI,
security review, adversarial misleading-state review, accessibility review for
new UI, and general code quality review.

Rollback: revert surface commit; the underlying contract/evidence remains
available to earlier APIs. Residual risk: a surface can display only evidence
the harness exposes, so unavailable runtime policy remains explicitly unproven.

## Slice 5 - Canonical Documentation and Roadmap Closure

Commit: `docs(architecture): close trusted execution integrity roadmap`

### Files and durable promotion

- Update `docs/architecture/config-projection.md` with ownership, evidence,
  translation loss, idempotency, and governed remediation.
- Update `docs/architecture/harness-integration-capabilities.md` with Codex,
  Claude Code, and OpenCode enforcement distinctions.
- Update `docs/architecture/execution-surfaces.md` and
  `docs/architecture/operator-workspace.md` with shared status/doctor semantics.
- Update `docs/architecture/managed-agents.md` with child authority evidence,
  replay, and fail-closed unattended admission.
- Add/update the operator guide owning personal configuration (discover under
  `docs/guides/`) with an explicit, dangerous, revocable, operator-local trusted
  development example that is not presented as the team/public default.
- Update `README.md` only if the public command/contract description changed.
- Add implementation history and residual risks to `docs/changelog.md`.
- Mark every slice complete in roadmap 05, promote all durable content, update
  `docs/roadmap/README.md`, then delete
  `docs/roadmap/05-trusted-execution-integrity.md` only after all gates pass.

Run documentation link/reference scans and generated projection consistency;
do not hand-edit generated projections. If canonical project context changes,
regenerate through the repository command discovered from existing sync tests
and stage only intended generated output.

## Final Independent Reviews

Before Slice 5 closure, obtain and resolve all blocking findings from:

1. architecture and DDD/Clean Architecture boundary review;
2. security and authority-escalation review;
3. config projection ownership/idempotency review;
4. managed-agent inheritance, route identity, replay, and failure review;
5. general code quality review;
6. adversarial stale, contradictory, partial, selected-versus-effective, resume,
   automation, and child-downgrade review.

Rerun every focused suite affected by a review fix, then its package gate and
typecheck. Record findings and resolutions in roadmap 05 before deleting it.

## Final Verification and Commit Hygiene

Run the canonical commands exactly from `.kiln/project-context.md`:

```bash
bun run --filter @kilnai/gateway-contracts test && bun run --filter @kilnai/core test && bun run --filter @kilnai/runtime test && bun run --filter @kilnai/cli test && bun run --filter @kilnai/react test && bun run --filter @kilnai/widget test && bun run --filter @kilnai/tui test && bun run --filter @kilnai/native test && bun run --filter @kilnai/studio test && bun run --filter @kilnai/gui test
tsc -b packages/gateway-contracts packages/core packages/runtime packages/sdk packages/cli packages/tui packages/native && tsc -p packages/widget/tsconfig.json --noEmit && tsc -p packages/studio/tsconfig.json --noEmit && tsc -p packages/gui/tsconfig.json --noEmit
bun run --filter '*' build
bun run --cwd packages/gui test:e2e
git diff --check
```

Then run focused doctor/config-status/projection/managed-agent/CLI/GUI/TUI suites,
search for stale roadmap and old flattened permission classifications, run the
repository’s generated projection consistency check, and verify `git status
--short`. Investigate and rerun any Windows temporary-cleanup flake while
retaining the first failure in the final report.

For every commit, inspect `git status --short` and `git diff --cached --name-only`
before committing. Stage only the owning slice. Never stage the pre-existing
generated `AGENTS.md` or `CLAUDE.md` changes unless a deliberate canonical
change regenerated them in Slice 5 and review proves they belong to that commit.
Never use `--no-verify`.

## Completion Criteria

Completion requires all five atomic commits, all required deterministic tests,
workspace tests, typecheck, build, GUI E2E/browser validation, independent
reviews, canonical documentation promotion, roadmap closure, generated
projection consistency, stale-reference scan, and a clean worktree. Any
unobservable runtime state must remain explicitly `effective-policy-unproven`
or a more severe evidence classification; it is a documented residual risk,
not grounds to weaken admission or claim proof.
