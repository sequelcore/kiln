# X Feature Intake Completion Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Complete the read-only X pilot as a long-term external-engagement feature by
turning accepted or narrowed operator decisions into provider-neutral feature
intake proposals with stable workspace storage.

## Non-Goals

- No write-capable X actions.
- No runtime/GUI surface in this slice.
- No provider expansion beyond X.
- No full source text, handles, source URLs, or real private post ids in public
  docs/tests.
- No roadmap mutation or automatic implementation planning.

## Scout Map

- `packages/core/src/external-engagement/index.ts` owns provider-neutral intake
  report construction from decision reports.
- `packages/cli/src/commands/external-engagement.ts` owns the `x-promote`
  operator surface and default `.kiln/external-engagement/feature-intake.json`
  workspace output.
- `docs/guides/external-engagement.md` owns the public end-to-end lifecycle.

## Implementation Slices

1. Intake domain model
   - Add feature-intake proposals and reports.
   - Promote only `accept` and `narrow` decisions.
   - Keep `defer` and `reject` as decision history only.

2. CLI promotion
   - Add `x-promote --decisions`.
   - Write to `.kiln/external-engagement/feature-intake.json` by default.
   - Keep the command offline, credential-free, and network-free.

3. Documentation and cleanup
   - Document the full read-only lifecycle.
   - Keep write-capable engagement documented as a separate future contract.

## Verification

- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run --filter @kilnai/core test`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: privacy grep for the private X source handles and real post ids.

---

# X Candidate Decision Report Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Move the X pilot from review-only analysis to governed product intake by
recording operator decisions against feature candidates without copying private
source evidence into the decision artifact.

## Non-Goals

- No additional X API calls.
- No write-capable engagement.
- No roadmap/proposal persistence yet.
- No full source text, handles, URLs, or real source ids in public docs/tests.
- No LLM-dependent decision making.

## Scout Map

- `packages/core/src/external-engagement/index.ts` owns pure decision report
  construction and validation against a feature candidate report.
- `packages/cli/src/commands/external-engagement.ts` owns `x-decide` as an
  offline JSON transformation.
- `docs/guides/external-engagement.md` owns operator guidance for the
  review-to-decision workflow.

## Implementation Slices

1. Core decision model
   - Add `accept`, `defer`, `reject`, and `narrow` decision states.
   - Store decisions against candidate ids and evidence artifact ids.
   - Reject unknown candidates, duplicate candidate decisions, empty evidence,
     and evidence ids not present on the candidate.

2. Decision validation
   - Require reasons for `accept`, `reject`, and `narrow`.
   - Require `narrowedScope` for `narrow`.
   - Exclude source-derived summaries and full artifact text from the decision
     report.

3. CLI surface
   - Add `x-decide --candidates --decisions --output`.
   - Keep the command offline, credential-free, and network-free.

## Verification

- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run --filter @kilnai/core test`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: privacy grep for the private X source handles and real post ids.

---

# X Signal Quality And Review Report Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Improve the X pilot's product usefulness after the first candidate report by
reducing noisy signal fan-out, grouping candidates by durable themes, and
adding an offline operator review report that is safe to discuss without
copying full source text.

## Non-Goals

- No additional X API calls.
- No LLM-dependent extraction.
- No real source URLs, handles, ids, or artifact text in public docs/tests.
- No operator decision persistence yet.
- No write-capable engagement.

## Scout Map

- `packages/core/src/external-engagement/index.ts` owns signal grouping,
  candidate consolidation, and review report construction.
- `packages/cli/src/commands/external-engagement.ts` owns `x-review` as an
  offline transformation from candidate JSON to Markdown.
- `docs/guides/external-engagement.md` owns public operator guidance for the
  offline analysis/review workflow.

## Implementation Slices

1. Signal quality
   - Add stable signal themes.
   - Limit each evidence artifact to at most two signal groups.
   - Preserve evidence ids while avoiding repeated candidates from one noisy
     artifact.

2. Candidate consolidation
   - Merge multiple signals for the same theme into one candidate.
   - Preserve source signal kinds and unique evidence artifact ids.

3. Review report
   - Add a core review report model and Markdown rendering.
   - Add `x-review --candidates --output` as an offline CLI command.
   - Exclude full artifact text from the default review output.

## Verification

- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run --filter @kilnai/core test`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: private `x-candidates` rerun against the live cached report; summary:
  5 candidates with unique themes.
- Passed: private `x-review` generation to Markdown outside the repo.

---

# Earlier Historical Plans

# X Live Validation And Candidate Report Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Complete the next X pilot slice end to end: intentionally validate OAuth2
refresh, run a bounded cached report against the operator's private source
list, add conservative evidence-to-signal extraction, and produce feature
candidates from an existing report without further X API spend.

## Non-Goals

- No public repo copy of the operator's real X source list.
- No token values in logs, docs, tests, or reports committed to git.
- No write-capable X engagement.
- No hidden live calls during candidate generation.
- No LLM-dependent signal extraction in this slice.

## Scout Map

- `packages/core/src/external-engagement/index.ts` owns pure signal extraction
  and feature-candidate report construction.
- `packages/cli/src/commands/external-engagement.ts` owns the offline
  `x-candidates` transformation.
- `C:/tmp` owns private live outputs and temporary scripts for this validation;
  those files are not part of the public repo.
- The private research memo owns the real source list and process notes.

## Implementation Slices

1. Live credential validation
   - Run `x-refresh --allow-live` with secret output outside the repo.
   - Update Doppler with the new access and refresh tokens through stdin,
     without printing values.

2. Live bounded report
   - Build a private source input from the private memo.
   - Run `x-report` with `--max-replies 5`, explicit cache dir, and output
     outside the repo.
   - Confirm a second run uses cache without credentials.

3. Core signal extraction
   - Add deterministic, conservative signal extraction from evidence artifacts.
   - Keep extraction source-grounded and low/medium confidence only.

4. Feature-candidate report
   - Add a pure candidate report model with recommendation, confidence,
     evidence ids, and engineering-standards assessment.
   - Add `x-candidates --report --output` as an offline CLI command.

## Verification

- Passed: live `x-refresh --allow-live` on 2026-06-24; stdout summary was
  secret-free and reported access plus refresh token receipt.
- Passed: Doppler update for `KILN_X_OAUTH2_ACCESS_TOKEN` and
  `KILN_X_OAUTH2_REFRESH_TOKEN` via stdin without printing token values.
- Passed: live `x-report` on the private 18-reference source list with
  `--max-replies 5`; report summary: 98 artifacts, 21 estimated requests.
- Passed: cache-hit `x-report` rerun without Doppler credentials.
- Passed: live `x-candidates` against the private report; summary: 5
  candidates, with 3 `adapt`, 1 `later`, and 1 `adopt` recommendation.
- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run --filter @kilnai/core test`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `bun run typecheck`
- Passed: `git diff --check`

---

# Earlier Historical Plans

# X OAuth2 Refresh Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Add an explicitly gated X OAuth 2.0 refresh command so operators can rotate
short-lived user access tokens without printing token values or tying Kiln to a
specific secret manager. The command must use `SecretRef` declarations,
separate refresh from evidence reads, and support both confidential and public
OAuth 2.0 clients.

## Non-Goals

- No automatic secret-manager persistence.
- No Doppler-specific adapter or public assumption.
- No automatic refresh during `x-report`.
- No write-capable X engagement.
- No real operator source URLs, handles, ids, or credentials in docs/tests.

## Scout Map

- `packages/core/src/external-engagement/index.ts` owns reusable X credential
  declarations and stays IO-free.
- `packages/cli/src/commands/external-engagement.ts` owns the first live X
  refresh adapter and must keep live execution behind `--allow-live`.
- `packages/cli/src/commands/external-engagement.test.ts` owns command
  behavior coverage with injected refreshers and synthetic token values.
- `docs/guides/external-engagement.md` owns public operator guidance and must
  describe secret output without assuming Sequel infrastructure.

## Implementation Slices

1. Core credential declarations
   - Add `SecretRef` factories for X OAuth2 refresh token, client id, and
     client secret.
   - Keep values outside diagnostics and tests.

2. CLI refresh command
   - Add `kiln external-engagement x-refresh --allow-live --secret-output`.
   - Resolve refresh credentials through `SecretResolver`.
   - POST to X's OAuth2 token endpoint through a narrow refresher adapter.
   - Write refreshed tokens only to the explicit secret output path.
   - Print only a secret-free JSON summary.

3. Tests and docs
   - Prove missing `--allow-live` and missing `--secret-output` fail before
     credential resolution.
   - Prove confidential-client refresh resolves all three refs and does not
     expose token values in stdout.
   - Prove public-client refresh skips client-secret resolution.
   - Document manual persistence to the operator's selected secret manager.

## Verification

- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: privacy grep for the operator-provided X handles and post ids
- Not run: live `x-refresh --allow-live`, because X may rotate real refresh
  tokens and the operator did not explicitly request a live credential
  rotation during verification.

---

# Earlier Historical Plans

# X Evidence Report Cache Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Add a local cache for read-only X evidence reports so repeated exploration of
the same bounded query does not spend additional X API requests. Cache use must
be deterministic, operator-controllable, and local-only.

## Non-Goals

- No shared remote cache.
- No caching of secrets or authorization headers.
- No hidden live calls on cache hits.
- No cache keys containing raw X source URLs or operator workflow handles.
- No write-capable external engagement.

## Scout Map

- `packages/cli/src/commands/external-engagement.ts` owns `x-report` execution
  and can check cache before credential resolution.
- `packages/cli/src/commands/x-evidence-report-cache.ts` owns file cache
  serialization and validation.
- `.kiln/cache` is ignored by git, matching existing local cache conventions.
- `docs/guides/external-engagement.md` owns operator cache guidance.

## Implementation Slices

1. File cache adapter
   - Add a versioned local JSON cache for `ExternalEvidenceReport`.
   - Key by X post ids and `maxRepliesPerPost`, not raw URLs.
   - Ignore malformed cache files fail-open by refetching.

2. CLI integration
   - Read cache before credential resolution and network access.
   - Write successful reports after fetch.
   - Add `--cache-dir`, `--no-cache`, and `--refresh-cache`.

3. Tests and docs
   - Prove cache hits skip credential resolution and fetch.
   - Prove file cache reuse with a temp directory.
   - Prove refresh and no-cache modes.
   - Document cache location and controls.

## Verification

- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run typecheck`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `git diff --check`
- Passed: manual cache refresh using `KILN_X_BEARER_TOKEN` with `--max-replies 0`
- Passed: manual cache hit without Doppler or token using the same cache dir

---

# Earlier Historical Plans

# X Live Smoke Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Add an explicitly gated, read-only X live smoke command that validates the
configured X credential through the existing `SecretRef` resolver before
continuing with broader external-engagement work. The smoke path must be
bounded to one request, opt-in, scriptable, and secret-free.

## Non-Goals

- No live execution from default tests.
- No posting, replying, liking, reposting, following, DMs, or write-capable
  platform action.
- No OAuth refresh execution.
- No new secret-manager adapter.
- No real operator research source URLs in docs or tests.

## Scout Map

- `packages/cli/src/commands/external-engagement.ts` owns the CLI surface and
  X REST boundary.
- `packages/cli/src/commands/external-engagement.test.ts` owns mocked command
  coverage; live network calls must stay injected or manually invoked.
- `docs/guides/external-engagement.md` owns operator guidance for the X pilot.
- X official docs identify `/2/users/me` as the authenticated user lookup
  endpoint and document rate-limit headers. The smoke should use that endpoint
  because it proves token validity without inspecting conversations or writing.

## Implementation Slices

1. CLI command path
   - Add `kiln external-engagement x-smoke --allow-live`.
   - Reuse `createXReadAccessTokenRef` and `EnvSecretResolver`.
   - Fail before credential resolution unless `--allow-live` is present.
   - Return bounded JSON with request count, authenticated user identity, and
     rate-limit metadata when present.

2. Tests
   - Prove `x-smoke` requires explicit live approval before credential
     resolution.
   - Prove approved smoke uses `SecretRef`, injects the smoke tester, and does
     not expose token values.

3. Documentation
   - Document `x-smoke --allow-live` as manual live validation only.
   - Keep public docs provider-neutral and read-only.

## Verification

- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run typecheck`
- Passed: `git diff --check`

---

# Earlier Historical Plans

# X SecretRef Integration Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Finish the next narrow governed external-engagement slice by making X-specific
credential declarations consume the provider-agnostic `SecretRef` boundary
directly. The command must fail before X network access when credential
lifecycle diagnostics are not usable, without adding OAuth refresh execution or
secret-manager-specific dependencies.

## Non-Goals

- No Doppler runtime dependency.
- No direct integration with Vault, 1Password, Doppler, or cloud
  secret-manager APIs.
- No OAuth token refresh execution.
- No migration of runtime provider credential pools.
- No write-capable X or external-engagement actions.
- No real credentials, real research URLs, or secret screenshots in tests/docs.

## Scout Map

- `packages/core/src/credentials/index.ts` owns IO-free `SecretRef`, lifecycle
  metadata, validation, resolver contract, and secret-free diagnostics.
- `packages/core/src/external-engagement/index.ts` owns source-neutral evidence
  contracts and should own X's reusable read-token declaration.
- `packages/cli/src/credentials/env-secret-resolver.ts` owns the first
  env-backed adapter.
- `packages/cli/src/commands/external-engagement.ts` is the only X command path
  changed; it should consume the core X token declaration and stop before the X
  fetcher receives a token when lifecycle diagnostics are not usable.
- `packages/runtime` remains untouched. Runtime credential pools still own
  managed provider route rotation and health persistence.

## Implementation Slices

1. Core X credential declaration
   - Add a reusable `createXReadAccessTokenRef` factory in external engagement
     core.
   - Preserve provider-agnostic `SecretRef` semantics and env-backed defaults.
   - Tests: default source, override env name, and lifecycle metadata.

2. CLI lifecycle gate
   - Refactor `external-engagement x-report` to consume the core X
     access-token declaration.
   - Fail before X network access when diagnostics report `refresh-due`,
     `rotation-due`, or `expired`.
   - Preserve the existing `--access-token-env` operator surface.

3. Documentation
   - Update external engagement and credential governance docs with the X
     declaration boundary and lifecycle gate.

## Verification

- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run typecheck`
- Passed: `git diff --check`

---

# Earlier Historical Plans

# Credential Governance Foundation Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Add the minimal long-term credential-governance foundation needed before
expanding governed external engagement. The slice introduces provider-agnostic
secret references, env-backed resolution as the first adapter, safe diagnostics,
and documentation that avoids making Sequel infrastructure a public Kiln
assumption.

## Non-Goals

- No Doppler runtime dependency.
- No direct integration with Vault, 1Password, or cloud secret-manager APIs.
- No OAuth token refresh execution.
- No migration of runtime provider credential pools.
- No write-capable X or external-engagement actions.
- No real credentials, real research URLs, or secret screenshots in tests/docs.

## Scout Map

- `packages/core/src/credentials/index.ts` owns IO-free `SecretRef`, lifecycle
  metadata, validation, resolver contract, and secret-free diagnostics.
- `packages/cli/src/credentials/env-secret-resolver.ts` owns the first
  env-backed adapter.
- `packages/cli/src/commands/external-engagement.ts` is the only X command path
  changed; it now resolves the access token through a `SecretRef` before the X
  fetcher receives the raw token.
- `packages/runtime` remains untouched. Runtime credential pools still own
  managed provider route rotation and health persistence.

## Implementation Slices

1. Core credential contract and pure diagnostics
   - Add provider-agnostic `SecretRef`, env source, managed secret-manager
     source, runtime credential-pool source, purpose/scope metadata, expiry,
     rotation, refresh metadata, lifecycle decisions, and safe diagnostic
     statuses.
   - Tests: validation, diagnostic redaction, expiry fail-closed behavior.

2. CLI env resolver and X command boundary
   - Add `EnvSecretResolver` implementing the core resolver contract.
   - Refactor `external-engagement x-report` to build a governed X access-token
     reference and resolve it before calling the X REST fetcher.
   - Preserve the existing `--access-token-env` operator surface.

3. Documentation
   - Add architecture documentation for the `SecretRef` boundary.
   - Update external engagement docs to describe provider-agnostic credential
     resolution and env injection without treating Doppler as a public default.

## Verification

- Passed: `bun run --cwd packages/core test tests/credentials/secret-ref.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/credentials/env-secret-resolver.test.ts src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run typecheck`
- Passed: `git diff --check`

## Credential Governance Closeout

- Managed secret-manager sources are modelled as provider-neutral references.
  Provider-specific adapters can implement `SecretResolver` without changing
  external-engagement contracts.
- OAuth refresh and rotation metadata now has pure lifecycle evaluation.
  Provider-specific refresh execution remains an adapter responsibility, not a
  core dependency.
- Runtime credential pools have a core `credential-pool` source handle, so
  future integration work can bridge to runtime-owned pool resolution without
  importing runtime into core.

---

# Historical Plans

# Governed External Engagement Plan

Date: 2026-06-24
Status: Superseded by credential governance foundation on 2026-06-24

## Objective

Add the first public Kiln slice for governed external engagement: a read-only X
evidence ingestion path that lets an operator provide post URLs or ids, fetches
bounded public evidence, and produces a structured report for community-signal
analysis. The long-term feature is external engagement governance, not social
posting automation.

## Non-Goals

- No posting, replies, likes, reposts, follows, DMs, or write-capable platform
  actions in this slice.
- No channel adapter yet. X is an external evidence source first, not a runtime
  conversation channel.
- No browser/cookie scraping.
- No unbounded API loops or hidden retries.
- No test dependency on live X API calls.
- No Sequel-only framing in public package contracts.

## Scout Map

- `packages/core` owns domain contracts, action-effect governance, and
  source-neutral primitives.
- `packages/cli` owns the first operator-facing experimental command surface.
- `packages/runtime` owns gateway/channel adapters and should not be touched for
  this first read-only CLI slice.
- Existing action-effect contracts in
  `packages/core/src/engine/domain/action-effect.ts` already model external,
  authenticated, read-only effects.
- Existing integration contracts in
  `packages/core/src/engine/domain/integration.ts` provide an adapter shape but
  do not model evidence reports or budgeted external source ingestion.

## Implementation Slices

1. Core domain contract and pure behavior
   - Add source-neutral external engagement/evidence types.
   - Add X URL/id normalization as pure parsing.
   - Add request-budget planning for root posts and bounded replies.
   - Add evidence report construction with source provenance.
   - Tests: parser, duplicate handling, invalid URLs, budget estimates, and
     read-only action-effect classification.

2. CLI command surface
   - Add `kiln external-engagement x-report`.
   - Inputs: `--url`, `--input`, `--max-replies`, `--output`,
     `--dry-run`, `--access-token-env`.
   - Default to dry-run unless an access token env var is present and
     `--dry-run` is not supplied.
   - Emit JSON by default to keep the first surface scriptable.
   - Tests: argument parsing and command output with an injected fetcher.

3. X API adapter boundary
   - Implement a small CLI-local X fetcher using the official REST API.
   - Use OAuth bearer access token from environment only.
   - Enforce max ids and max replies before network calls.
   - Return rate/cost metadata when headers or request planning allow it.
   - Tests use fixtures and mock fetch only.

4. Documentation
   - Add public docs for governed external engagement and the X pilot.
   - Document secrets as env vars only, no values.
   - Document cost controls, caching expectations, and no-write phase-1 scope.

## Verification

- `bun run --cwd packages/core test tests/external-engagement`
- `bun run --cwd packages/core build`
- `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/cli test`
- `bun run typecheck`
- `git diff --check`

## Residual Risks To Review

- X API pricing and rate limits can change; the first implementation must keep
  cost estimates advisory and fail closed when limits are exceeded.
- OAuth refresh-token handling is intentionally excluded. Token refresh belongs
  to a later credential-governance slice.
- Publishing/replying requires a separate action-proposal and approval workflow
  before any write-capable adapter is added.

# Managed-Agent Core Reliability Plan

Date: 2026-06-05
Status: Closed on 2026-06-05

## Objective

Rework Kiln managed-agent harness reliability around explicit, replayable
runtime contracts instead of flags or UI-local state. The first implementation
slice fixes direct-provider credential availability evidence so Codex OAuth
routes cannot fail with an opaque "pool exhausted" state when Kiln already has
enough local information to explain expired, invalid, cooling, or absent
credentials.

## Non-Goals

- No full UI rewrite in this slice.
- No hidden live-provider execution.
- No fallback from direct providers to CLI harnesses.
- No secret-bearing diagnostics.
- No legacy compatibility branch for old credential shapes.

## Implementation Slices

1. TDD: Codex OAuth credential availability diagnostics
   - Add coverage proving expired and malformed Codex OAuth credentials remain
     visible in status but block direct adapter creation with a structured,
     secret-free exhaustion diagnostic.
   - Add coverage proving generic pooled exhaustion also carries provider,
     count, entry-health, and last-outcome evidence.

2. Runtime implementation: fail-fast provider availability
   - Extend the credential-pool error contract with a typed diagnostic.
   - Build Codex OAuth diagnostics from `listStatus()` before returning a direct
     pooled adapter when there are no executable credentials.
   - Preserve existing retry rotation for valid credentials.

## Slice 1 Closeout

Completed on 2026-06-05. `AllCredentialsExhaustedError` now carries a
secret-free `CredentialExhaustionDiagnostic`, generic pooled adapters include
provider/count/health/last-outcome evidence on exhaustion, and Codex OAuth
direct adapter creation fails fast when the local pool has no executable
credential. Expired and invalid Codex OAuth entries remain visible in status
without exposing access or refresh tokens.

Local pool diagnosis on this machine found five `codex-oauth` credentials and
all are expired: four expired on 2026-05-23 between 11:45:39Z and 11:50:33Z,
and one expired on 2026-06-04 at 08:25:35Z. Native Codex CLI live proof remains
separate and passed through the CLI harness route.

Verification passed:

- `bun run --cwd packages/core build`
- `bun run --cwd packages/core test tests/agents/credential-pool.test.ts`
- `bun run --cwd packages/runtime test tests/agents/codex-oauth-credential-pool.test.ts`
- `bun run --cwd packages/cli test tests/wrapper/direct-provider-adapter-factory.test.ts`
- `bun run typecheck`
- `bun run test:harness`
- `bun run test:managed-agents:live`
- `bun run build`
- `bun run test`
- `git diff --check`

3. Durable managed prompt admission
   - Introduce a managed-agent admission inbox contract modelled after the
     OpenCode `session_input` pattern: exact retry idempotency, conflicting
     prompt id rejection, explicit `steer` versus `queue`, and replay cursor
     semantics.

4. Cross-surface prompt control and recovery evidence
   - Wire GUI managed-agent controls to durable prompt admission instead of
     local UI-only state.
   - Project prompt admission and stale-prompt recovery through canonical
     events, gateway frames, event presentation, and cockpit read models.
   - Keep recovery replayable: stale prompts become `stale` with recovery
     reason and timestamp instead of being silently dropped or retried.

## Verification

- `bun run --cwd packages/core test tests/agents/credential-pool.test.ts`
- `bun run --cwd packages/runtime test tests/agents/codex-oauth-credential-pool.test.ts`
- `bun run --cwd packages/cli test tests/wrapper/direct-provider-adapter-factory.test.ts`
- `bun run typecheck`
- `bun run test:harness`
- `bun run test:managed-agents:live`
- `bun run build`
- `bun run test`
- `git diff --check`

## Final Closeout

Closed on 2026-06-05. Managed-agent operator follow-up prompts now enter a
runtime prompt inbox with stable prompt admission ids, prompt hashes, delivery
mode, delivery state, wake intent, operator identity, and request source.
`steer` prompts are immediately claimable, `queue` prompts wait for a safe-turn
boundary, delivered prompts are not reclaimed, and stale active admissions are
marked with recovery evidence rather than being silently retried or left as
ambiguous active state.
Runtime adapters receive a prompt-delivery coordinator in their invocation
input, so interactive adapters have a runtime-owned path to claim admitted
prompts during an active child run. Existing one-shot adapters keep their
one-turn execution contract and do not simulate interactive delivery without a
provider-native input mechanism.

GUI `managed_agent_control` frames now admit `prompt` actions through the
gateway, append canonical `agent_invocation_prompt_admitted` events, update the
live runtime invocation service, publish managed-agent prompt tool evidence,
and stream accepted control results back to the operator surface. Cockpit
projections and event presentation include prompt admission count, latest
prompt admission, delivery state, and `agent_invocation_prompt_recovered`
evidence.

After the operator refreshed Codex OAuth credentials on 2026-06-05, explicit
Codex OAuth direct-provider live proof passed both the governed read fixture
and the approved write fixture. The remaining skipped live files were provider
routes that were not explicitly admitted for that run, not false success.

# Harness Reliability Repair Plan

Date: 2026-06-05
Status: Closed on 2026-06-05

## Objective

Make Kiln managed-agent harness verification deterministic and honest across
runtime, GUI, TUI, and gateway-contract surfaces. The repair must prevent root
mixed test invocations from bypassing package configuration and must make live
managed-agent proof run authenticated local harnesses when available or fail
explicitly when no live provider is admitted.

## Non-Goals

- No full runtime rewrite in this slice.
- No weakening of managed-agent authority, handoff, replay, or write evidence.
- No hidden provider calls, retries, or compatibility shims.
- No GUI redesign; this slice fixes the verification contract first.
- No live provider execution unless the required `KILN_LIVE_*` flags are
  explicitly present.

## Implementation Slices

1. TDD: live preflight contract
   - Add coverage proving managed-agent live proof reports a failed preflight
     when the global live flag is missing, when no provider flag is enabled,
     and when at least one provider is enabled.
   - Keep provider selection explicit through the existing `KILN_LIVE_*`
     variables.

2. Harness command repair
   - Add a root `test:harness` command that runs the focused deterministic
     managed-agent cockpit/session tests through each package's own Vitest
     configuration.
   - Route `test:managed-agents:live` through a live runner that detects
     authenticated local Codex and OpenCode harnesses, sets the matching live
     environment, and then runs the runtime package's `test:live` script.

3. Documentation and operator evidence
   - Keep this plan updated with the exact verification gates.
   - Treat skipped live proof as missing evidence, not a successful test run.

## Verification

- `bun run --cwd packages/runtime test tests/managed-agent/live-test-harness.test.ts`
- `bun run test:harness`
- `bun run test:managed-agents:live` with no `KILN_LIVE_*` flags must fail
  during preflight only when no authenticated local harness is detected.
- `bun run typecheck`
- `bun run build`
- `git diff --check`

## Closeout Notes

The deterministic harness gate now runs through package-owned Vitest
configuration and explicitly excludes runtime live provider suites. The live
managed-agent command now runs a preflight/runner that auto-detects
authenticated local Codex and OpenCode harnesses, sets the matching live flags
for the child process, and fails only when no explicit or detected live provider
is admitted. Skipped live proof can no longer be misread as successful evidence.

Verification on 2026-06-05 passed `bun run test:harness`, `bun run typecheck`,
`bun run build`, and `git diff --check`. `bun run test:managed-agents:live`
without manual `KILN_LIVE_*` flags auto-detected Codex and OpenCode on this
machine and passed real live proof: Codex read-only write denial, Codex
approved fixture write with canonical write evidence, and OpenCode cancellation
with late-write suppression. A manual Codex OAuth direct-provider read proof
reached the adapter but failed with credential-pool exhaustion for
`codex-oauth`/`gpt-5.5`; that route remains explicit-only until credentials are
actually available.

# Managed Handoff Recovery Plan

Date: 2026-05-29
Status: Closed on 2026-05-29

## Objective

Fix the governed managed-invocation failure path found in the GUI live session:
a child completed without substantive handoff evidence, Kiln produced recovery
instructions, and the parent did not record evidence or restart execution. The
fix must keep evidence gates strict, support local frontend reference repos, and
make timeout or no-handoff states replayable and actionable across surfaces.

## Non-Goals

- No bypass for `handoff_not_substantive`.
- No weakening of visual-reference evidence validation.
- No request-local timeout shim or hidden retry loop.
- No legacy compatibility branch for old transcript shapes.
- No GUI redesign in this repair slice.

## Implementation Slices

1. TDD: governed outcome regression - closed
   - Add coverage in
     `packages/runtime/tests/session/governed-turn-outcome.test.ts` proving
     `managed_agent.invoke` with `handoff_not_substantive` and
     `managedInvocationRecovery.nextTool = work_item.update` remains failed
     until the matching work item records the required evidence.

2. TDD: local frontend-reference evidence - closed
   - Add coverage in
     `packages/cli/src/application/work-governance-tool.test.ts` proving local
     repository frontend evidence from `/workspace/references/t1code` or
     `/workspace/references/vllm-studio` is accepted only when it cites concrete
     frontend paths and code-backed UI principles.
   - Update managed visual-reference phase routing so local code-backed
     reference research can use read/glob-style tools instead of being forced
     through web-only tooling.

3. TDD: direct-provider no-handoff summary - closed
   - Add coverage in
     `packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
     proving an empty child final response records a bounded, actionable
     no-handoff summary and replayable transcript pointer.
   - Keep runtime substantive-evidence validation strict so this state still
     becomes `handoff_not_substantive` at the managed tool boundary.

4. Runtime and CLI implementation - closed
   - Update the outcome classifier in
     `packages/runtime/src/session/governed-turn-outcome.ts`.
   - Update direct runtime handoff summary handling in
     `packages/runtime/src/agents/managed-invocation/direct-runtime-adapter.ts`
     and strict no-handoff detection in
     `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`.
   - Update visual-reference evidence/tool requirements in
     `packages/cli/src/application/work-governance-tool.ts`.

5. Documentation and research closeout - closed
   - Record timeout/retry design implications from AWS, Google, Microsoft,
     Google Cloud, OpenAI Agents SDK, Anthropic SDK guidance, and tail-latency
     papers in the roadmap closeout.
   - Update `docs/roadmap/README.md` after verification.

6. TDD: direct child execution replay evidence - closed
   - Add coverage in
     `packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
     proving direct-provider children with tool execution evidence or empty
     final output expose a bounded `child-execution` managed resource.
   - Preserve bounded model-facing summaries while making the child stop
     reason, token usage, tool calls, tool outputs, and empty final-output state
     replayable through `resource_read`.

7. TDD: deterministic no-handoff blocking path - closed
   - Add coverage in
     `packages/runtime/tests/gateway/managed-invocation-tool.test.ts` proving
     non-substantive visual-reference child handoffs include a
     `blockedWorkItemUpdateInputTemplate`.
   - Keep `workItemUpdateInputTemplate` as the happy recovery path only after
     real evidence exists; when transcript/source-resource inspection still
     cannot qualify evidence, the parent must block the work item with an
     unresolved pause requirement instead of replying with a generic failure.

8. Runtime execution contract propagation - closed
   - Add `stopReason` to the runtime orchestration result and propagate provider
     stop reasons through normal and fallback child turns.
   - Persist direct child execution replay resources from the direct runtime
     adapter without changing remote harness contracts or adding compatibility
     shims.

9. Review findings closeout - closed
   - Preserve `blockedWorkItemUpdateInputTemplate` and `blockedWhen` through
     gateway-contract cockpit projection and view-state.
   - Project `handoff_not_substantive` as failed managed-child attention instead
     of completed cockpit status.
   - Add targeted fallback `stopReason` coverage and public `resource_read`
     coverage for child-execution replay resources.

10. TDD: route-owned managed request recovery - closed
    - Add CLI coverage proving visual-reference managed invocation requests are
      route-owned and explicitly forbid `agentProfile` injection.
    - Add runtime coverage proving route/profile conflicts remain fail-closed
      while returning a structured `retryInputTemplate` that omits
      `agentProfile`, preserves work/goal/phase context, and records
      `forbiddenInputFields`.
    - Keep adapters uninvoked and child lifecycle events absent when admission
      fails before route identity is coherent.

11. TDD: route-owned canonicalization after GUI retry loop - closed
    - Add CLI coverage proving visual-reference phase requests with an explicit
      phase route do not carry stale caller-supplied `managedModel` hints from
      the write route.
    - Add attached-runtime coverage proving route-owned paused requests keep
      `agentProfile` absent when `forbiddenInputFields` forbids it, while
      hydrating the provider model from the selected route catalog.
    - Add attached-runtime coverage proving route-owned paused requests also
      drop caller-supplied stale provider models when the selected route uses
      the provider default model.
    - Add runtime coverage proving `managed_agent.invoke` canonicalizes a
      supplied forbidden `agentProfile` before route/profile validation, starts
      the selected route-owned child once, and records canonicalization
      evidence without admitting the forbidden profile into child identity.

12. TDD: managed child state-transition guard after GUI stress closeout - closed
    - Add runtime coverage for the latest GUI failure mode: after
      `managed_agent.invoke` returns `handoff_not_substantive` with
      `phase_evidence_required`, parent final text is rejected until the work
      item records qualifying evidence or an explicit blocked pause state.
    - Add runtime coverage for the sibling successful-child path:
      `managedInvocationPhaseCompletion` with `nextTool: "work_item.update"`
      also blocks final text until the phase evidence is recorded.
    - Add fail-closed runtime coverage for exhausted tool rounds while a
      managed child state transition is pending.
    - Add GUI store coverage so `turn_completed` events with
      `outcome: "failed"` render with error tone instead of success tone.
    - Keep timeout behavior bounded and explicit: no hidden retry loops, no
      compatibility shims, and no final response persisted while the governed
      state transition is unresolved.

13. TDD: managed invocation transition reserve after GUI live failure - closed
    - Add runtime coverage for the latest GUI failure mode from
      `.kiln/sessions/kiln-gui%3A_gui%3A0eb1c062-b0bb-4d8e-bd71-a461a33f06e8%3A1780052576091`:
      the parent consumed the normal tool-round budget inspecting managed-child
      and local frontend-reference evidence, then had no remaining round to
      record the required `work_item.update` recovery transition.
    - Add exactly one managed-invocation transition-only reserve round after
      normal tool rounds are exhausted while a `managedInvocationRecovery` or
      `managedInvocationPhaseCompletion` state transition is still pending.
    - In the reserve round, expose and execute only the required next work-item
      tool. Non-transition tools are returned as blocked tool results, and a
      missing or unadmitted transition tool fails closed with
      `managed_invocation_state_transition_required`.
    - Add coverage for evidence transition success, blocked pause transition
      success, wrong-tool blocking, phase-completion reserve success, missing
      transition-tool admission, and the absence of a false max-rounds error
      after a successful reserve.
    - Close reviewer finding by tracking all unresolved managed-invocation
      transitions in execution order. A later resolved child transition can no
      longer hide an earlier unresolved child transition in the same parent
      turn.
    - Keep runtime ownership clean: no automatic work-item writes, no hidden
      retries, no larger generic tool budget, and no placeholder evidence.

14. TDD: no-tools fallback protocol boundary after direct-child no-handoff - closed
    - Add runtime coverage for the latest GUI failure mode from
      `.kiln/sessions/kiln-gui%3A_gui%3A4ee1ae9f-586c-4839-bef4-7f4fdf858135%3A1780081054547`:
      the child direct-provider invocation exhausted the useful child turn,
      returned `stop_reason: "tool_calls"` with no final handoff text, and the
      parent had to block instead of treating the child output as evidence.
    - Harden the runtime no-tools fallback boundary so fallback responses that
      still contain tool calls, tool-like stop reasons, or empty text are not
      executed, retried, or classified as substantive final answers.
    - Add an explicit no-tools finalization prompt after normal tool rounds are
      exhausted, and emit deterministic stop reasons:
      `tool_rounds_exhausted` for max-round finalization failure and
      `no_tool_finalization_failed` for repeated malformed tool-call fallback
      failure.
    - Preserve the direct managed adapter as a projection boundary. It records
      the orchestrator result, child stop reason, token usage, and tool
      execution evidence as replay resources, and prefixes these deterministic
      finalization failures with the existing no-handoff summary so the managed
      tool boundary still returns `handoff_not_substantive`.
    - Keep timeout/tool-loop ownership clean: no hidden repair provider call,
      no automatic work-item write, no unbounded retry, no legacy transcript
      compatibility branch, and no success-like handoff when the child failed
      to produce final evidence.

## Verification

- `bun test packages/core/tests/work-governance/frontend-reference-evidence.test.ts packages/runtime/tests/gateway/managed-invocation-tool.test.ts packages/gateway-contracts/tests/operator-cockpit-projection.test.ts packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts packages/cli/src/application/work-governance-tool.test.ts packages/runtime/tests/session/governed-turn-outcome.test.ts packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/gateway-contracts test`
- `bun run --filter @kilnai/cli test`
- `bun run --filter @kilnai/runtime test`
- `bun run typecheck`
- `bun test packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
- `bun test packages/gateway-contracts/tests/operator-cockpit-projection.test.ts packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --test-name-pattern "preserves stop reason"`
- `bun test packages/runtime/tests/managed-agent/resource-provider.test.ts --test-name-pattern "direct child execution evidence"`
- `bun test packages/cli/src/application/work-governance-tool.test.ts --test-name-pattern "scopes managed UI work"`
- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern "explicit route contradicts"`
- `bun test packages/cli/src/application/work-governance-tool.test.ts --test-name-pattern "scopes managed UI work"`
- `bun test packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts --test-name-pattern "does not attach an agent profile"`
- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern "canonicalizes forbidden agentProfile"`
- `bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run --cwd packages/gui test tests/session-store.test.ts`
- `bun run --filter @kilnai/gui test`
- `bun run --filter @kilnai/gateway-contracts test`
- `bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run typecheck`
- `bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run typecheck`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --test-name-pattern "tool budget"`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --test-name-pattern "repeated-malformed fallback"`
- `bun test packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts --test-name-pattern "exhausted direct-provider tool loops"`
- `bun run --filter @kilnai/runtime test`
- `bun run typecheck`
- `bun run --cwd packages/runtime test tests/gateway/tui-gateway-clear.test.ts`
- `bun run --cwd packages/core test tests/orchestrator/orchestrator-field-runtime.test.ts`
- `bun run test`
- `bun run build`
- `git diff --check`

## Closeout Notes

The parent model can still choose not to follow structured recovery, so the
repair makes that condition impossible to misclassify as success. A
`handoff_not_substantive` child result remains blocked until the governed phase
records matching evidence with `work_item.update`, and GUI/TUI/CLI cockpit
projection now carries the recovery action as review attention.

Timeout handling stays route-owned. This slice records timeout budgets,
timeout source, replayable diagnostics, and no-handoff summaries instead of
adding hidden retries or request-local timeout shims.

The 2026-05-29 follow-up closes the remaining GUI live-session recovery gap:
the transcript pointer alone is no longer the only artifact after a direct
child produces no final handoff. Direct-provider children now emit a bounded
child-execution replay resource whenever the final output is empty or child
tools ran. No-handoff visual-reference recovery also gives the parent an
explicit blocked work-item update template for the case where source-resource
inspection and local recovery still cannot produce qualifying evidence. That
keeps the workflow fail-closed without recording placeholder evidence or
continuing the governed execution.

The latest 2026-05-29 GUI session did not reach child admission: the parent
retried a route-owned visual-reference request while adding `agentProfile`,
which contradicted the explicit route id. That is now fail-closed with a
machine-readable recovery payload. `work_item.execution.start` marks the
route-owned request with `forbiddenInputFields: ["agentProfile"]`, and
`managed_agent.invoke` returns `status: "route_profile_conflict"` plus a
preserved retry template that removes `agentProfile` without weakening
route/profile validation or starting a child.

The later 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A8d0f06a4-6189-47d1-96ff-bcc1beb51e37%3A1780046728980`
showed the remaining loop: a route-owned retry template omitted
`agentProfile`, but the attached request path could still re-materialize a
matching catalog profile from `routeId`, and the request also carried a stale
write-route model into the read-only visual-reference phase. That is closed by
canonicalizing route-owned requests at the runtime boundary. Forbidden
`agentProfile` input has no semantic effect before validation, context
resolution, child identity, or adapter invocation; attached paused requests do
not add a profile when the request forbids it; and explicit visual-reference
phase routes hydrate their effective model from the route catalog instead of
from caller-supplied `managedModel`. When the selected route intentionally has
no model, the stale caller model is removed instead of preserved.

Final verification on 2026-05-29 passed `bun run test`, `bun run build`, and
`git diff --check`. A concurrent `bun run test` plus `bun run build` attempt
briefly surfaced a field-runtime lifecycle timeout in core; rerunning that
Vitest file in isolation passed, and the subsequent sequential workspace test
passed.

The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A20afacf8-3b10-4b7d-905b-77d60686976a%3A1780050552811`
proved route-owned canonicalization was working: the child ran on the selected
visual-reference route and forbidden `agentProfile` input was canonicalized
away. The remaining failure was a governed state-transition gap. The managed
child returned `handoff_not_substantive` and the parent produced final blocked
text without recording either evidence or the blocked work-item template.
Runtime closeout now rejects final assistant text while either
`managedInvocationRecovery` or `managedInvocationPhaseCompletion` requires a
next work-item tool. If the tool-round budget is exhausted, the turn fails
closed with `managed_invocation_state_transition_required`. GUI projection now
shows failed `turn_completed` events with error tone.

Timeout research for this closeout follows the same production stance used by
AWS, Google SRE, Microsoft Azure, Google Cloud, and Anthropic: every remote or
cross-process call needs an explicit deadline, retries must be bounded and
backed off with jitter, overload must fail early instead of queuing
indefinitely, and long model calls should use streaming or batch/polling where
the provider supports it. The Kiln fix does not treat timeout as a reason to
silently retry or mark work complete; it makes unresolved child handoff states
visible, replayable, bounded, and unsafe to finalize until state is recorded.

Additional verification on 2026-05-29 passed `bun run typecheck`,
`bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`,
`bun run --cwd packages/gui test tests/session-store.test.ts`,
`bun run --filter @kilnai/gui test`, `bun run --filter
@kilnai/gateway-contracts test`, `bun run build`, and `git diff --check`.
An initial `bun run --filter @kilnai/runtime test` attempt had one suite-level
timeout in `tests/gateway/tui-gateway-clear.test.ts:350`; rerunning that file
in isolation passed all 18 tests, and a later standalone runtime package suite
passed with 177 test files and 2353 tests.

The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A0eb1c062-b0bb-4d8e-bd71-a461a33f06e8%3A1780052576091`
proved the prior fail-closed guard worked but exposed one final workflow gap:
the parent spent the last normal round reading child resources and local
frontend references, then could not apply the required `work_item.update`
transition. The runtime now grants exactly one transition-only reserve round
when a managed invocation state transition remains pending after normal rounds.
That reserve projects only the required next work-item tool, applies a
single-tool executor allowlist, blocks any non-transition tool calls, resolves
either evidence or blocked-pause transitions, and fails closed if the required
tool is missing or still not called. Successful reserve transitions now continue
to the final model response without emitting a false max-tool-rounds error.
Focused verification for this slice passed `bun run typecheck` and
`bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`.
Reviewer follow-up found that tracking only one pending child transition could
let a later resolved transition hide an earlier unresolved one. The runtime now
keeps unresolved transitions in execution order and returns the oldest pending
transition, with regression coverage proving that resolving the second child
does not clear the first. Follow-up verification passed the same focused
runtime test file with 61 tests and `bun run typecheck`.

The final 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A4ee1ae9f-586c-4839-bef4-7f4fdf858135%3A1780081054547`
proved the transition reserve and route-owned canonicalization were holding,
but exposed a child-runtime protocol gap: after tool use, the direct-provider
child returned an empty final handoff with `stop_reason: "tool_calls"`. The
runtime now treats no-tools fallback as a hard protocol boundary. If a
fallback response still requests tools, reports a tool-continuation stop
reason, or contains no final text, Kiln emits a deterministic non-substantive
result and does not execute or retry those tool calls. Direct-provider managed
children project that state as no-handoff evidence with a child-execution
resource, so parent governance still blocks until real evidence or an explicit
blocked pause is recorded.

This follows the researched timeout and retry posture: deadlines and tool
budgets are explicit, fallback is bounded, malformed or nonterminal model
behavior is not retried indefinitely, and replayable evidence replaces hidden
repair loops. Follow-up verification passed the two focused orchestrator
fallback regressions, the direct runtime adapter regression, the full runtime
package suite with 177 test files and 2362 tests, and `bun run typecheck`.

The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3Ae294e374-2b9e-4c4b-a144-dc03579522f2%3A1780083012476`
proved governance was correctly blocking placeholder visual-reference evidence,
but exposed two remaining issues. First, the parent process could inspect
`/workspace/references/t1code` and `/workspace/references/vllm-studio`, while the
managed read-only child could not because its direct-provider sandbox admitted
only the Kiln working directory. Second, a semantically valid blocked
`work_item.update` with a phase-specific pause id was not recognized as the
required managed-invocation recovery transition. Kiln now has explicit
`readAuthority.workspace` roots for read-only reference repositories, CLI route
projection carries those roots into read-only managed routes, direct-provider
child sandboxes admit them for reads without granting writes, and recovery
resolution accepts blocked transitions when the same work item records a pending
operator pause plus a failed verification gate for the required evidence. This
keeps sibling repo inspection governed and read-only, while preserving strict
phase evidence: missing visual-reference evidence still blocks instead of
recording placeholders.

Review follow-up closed the final two issues from this slice. A direct-provider
child that returns `managed_invocation_state_transition_required` is now
recorded as a failed managed invocation with child-execution replay evidence,
so it cannot be adopted as completed/substantive handoff evidence. Cancelled
GUI `turn_completed` events now render with error tone instead of success tone.
The live `~/.kiln/config.yaml` read-only research routes were also updated to
admit `/workspace/references/t1code` and `/workspace/references/vllm-studio` as
read-only reference roots while denying their `.git` and `node_modules`
subtrees.

Final verification passed `bun run test`, `bun run typecheck`,
`bun run build`, `bun run --filter @kilnai/runtime test`,
`bun run --filter @kilnai/gui test`, and `git diff --check`. The GUI build
still reports the existing chunk-size warning for large chunks; it does not
fail the build.
