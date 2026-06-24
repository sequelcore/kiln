# External Engagement Completion Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Finish governed external engagement as a public Kiln feature by adding bounded
X discovery, provider-neutral action proposal contracts, public-safe docs, and
verification before merging `architecture/governance-action-effects` into
`main`.

## Non-Goals

- No public write execution to X or any external platform.
- No unbounded browser or timeline exploration.
- No real X handles, tweet ids, URLs, source lists, credentials, or private
  workflow details in committed artifacts.
- No UI placeholder if the shared GUI/TUI/runtime surface is not ready to own
  this workflow.
- No secret-manager-specific public dependency.

## Scout Map

- `packages/core/src/external-engagement/index.ts` owns provider-neutral
  external engagement contracts, X query normalization, budgets, evidence
  reports, candidate decisions, feature intake, and future action authority
  models.
- `packages/core/tests/external-engagement/x-evidence-source.test.ts` owns
  core behavior coverage.
- `packages/cli/src/commands/external-engagement.ts` owns the first operator
  surface, X REST adapter, credential resolution, and bounded live calls.
- `packages/cli/src/commands/external-engagement.test.ts` owns CLI behavior
  coverage with injected fetchers and synthetic fixtures.
- `packages/cli/src/commands/x-evidence-report-cache.ts` owns local evidence
  report cache serialization.
- `docs/guides/external-engagement.md` owns public operator guidance.
- `docs/research/` owns source-grounded rationale, not architecture contracts.

## Implementation Slices

1. Core discovery and authority contracts
   - Add provider-neutral bounded discovery scope concepts.
   - Add X search query normalization and budget estimation.
   - Add action proposal, approval, and execution records with explicit actor
     authority and proposer/approver separation.

2. CLI bounded X search
   - Add `kiln external-engagement x-search --query ...`.
   - Support `--max-posts`, `--max-replies`, `--dry-run`, cache controls,
     bounded time/search scope, and request-budget confirmation.
   - Compose output as `ExternalEvidenceReport` so candidates, review,
     decisions, and intake work unchanged.

3. Documentation and research
   - Update the guide with discovery, budget/cache/sampling limitations,
     conversational UX contract, cross-surface contract, credentials, and
     future action authority.
   - Add public-safe research notes with official X docs, MCP/community demand
     signals, mixed-initiative/Human-AI guidance, and social-listening limits.
   - Keep `docs/plan.md` current and remove stale scratch history.

4. Verification and review
   - Run focused tests first, then core/CLI package tests, typecheck, and
     `git diff --check`.
   - Run DDD/Clean Architecture, security/privacy, UX/product, and dead-code
     reviews before committing.
   - Grep for private X sources, token-like secrets, and private workflow
     leakage.

## Verification

- Passed: `bun run --cwd packages/core test tests/external-engagement/x-evidence-source.test.ts`
- Passed: `bun run --cwd packages/core build`
- Passed: `bun run --cwd packages/cli test src/commands/external-engagement.test.ts`
- Passed: `bun run --cwd packages/cli build`
- Passed: `bun run --filter @kilnai/core test`
- Passed: `bun run --filter @kilnai/cli test`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
- Passed: changed-file privacy grep for token-shaped secrets.
- Passed: changed-file X URL/handle grep; committed X URLs are synthetic
  examples or generated `x.com/i/status` fixture URLs.
- Passed: review gates for DDD/Clean Architecture, security/privacy,
  UX/product, and dead-code/redundancy.

## Closeout

Implemented bounded X search discovery as a cache-aware CLI report source,
provider-neutral discovery scope and future action authority contracts in core,
public-safe architecture/guide/research docs, and no GUI/TUI placeholders.
Write-capable X execution remains intentionally unbuilt.
