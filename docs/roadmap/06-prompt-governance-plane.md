# 06 - Prompt Governance Plane

Status: Active staged-governance track
Execution: Queued - higher-priority Ready work closes first.
Created: 2026-07-21

## Objective

Make every effective provider prompt attributable, replayable, bounded, and
evaluated without turning prose into a second configuration or policy system.

## Ownership

This track owns prompt assembly evidence, activation of admitted instruction and
skill content, component evaluation, and privacy-safe operator inspection. Skill
eligibility belongs to Roadmap 05; provider/model/budget decisions remain config.

## Scope

- Typed effective-prompt manifests and final-request attribution.
- Content-free events and cross-surface inspection.
- Model-specific component evaluation and ablation.
- Progressive instruction, skill-resource, and tool-schema disclosure.
- Optional controlled-language packs with explicit authority.

## Non-Goals

- No raw prompt storage or hidden-reasoning surface.
- No universal brevity/personality formatting prompt.
- No model ranking, budget, permission, or stack version in doctrine.
- No prompt change promoted by token count or snapshots alone.

## Ordered Slices

### Slice 0 - Effective Prompt Foundation

Status: Complete.

Core owns one typed manifest; Runtime sends `manifest.finalPrompt`; hashes,
scopes, token estimates, validation, and privacy-safe request evidence are implemented.

### Slice 1 - Canonical Observation

Status: Queued; next admissible work after higher priorities.

Persist one `effective_prompt_observed` event for the final completed provider
request. Map it explicitly to Gateway contracts and project the same content-free
payload to CLI, TUI, GUI, SDK, and replay. Unsupported routes emit no fabricated evidence.

### Slice 2 - Evaluation And Ablation

Status: Research behind Slice 1.

Define component inventories, representative fixtures, per-model-family outcomes,
removal ablations, and promotion thresholds covering quality, tools, safety,
latency, tokens, cache, and failure categories.

### Slice 3 - Progressive Disclosure

Status: Queued behind Slice 2.

Roadmap 05 decides which skill is admitted; this slice decides when its body and
resources enter the prompt. Load nested instructions and nonessential schemas
only at explicit scope boundaries with budgets, deterministic order, and replay evidence.

### Slice 4 - Controlled Language Packs

Status: Blocked on validation contracts and distribution authority.

Separate guided drafting, deterministic validation, and human-certified
compliance. Package no licensed standard without authority.

## Promotion Gates

- One Runtime prompt authority exists for normal, retry, and fallback calls.
- Evidence contains hashes and counts, never prompt content or secrets.
- Skill activation consumes Roadmap 05 admission rather than recomputing it.
- No default component change bypasses model-specific evaluation.
- Safety and authority instructions are never deferred behind the action they govern.

## Verification

Core/Runtime/Gateway event tests, privacy serialization tests, cross-surface replay
parity, representative eval fixtures, workspace typecheck, affected-package tests,
and `git diff --check`.

## Completion Criteria

Operators can inspect exactly which content-free prompt components affected a
turn; changes are removable and evaluated; scoped content loads only after
explicit governed activation.
