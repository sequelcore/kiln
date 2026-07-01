# 05 - Research Turn Token Budgeting

Status: Deferred implementation slice governed by roadmap 06

## Objective

Make research-heavy GUI, CLI, TUI, and managed-agent turns bounded,
diagnosable, and evidence-efficient without weakening source quality, tool
traceability, or cross-surface parity.

This file owns the research-turn workload and its acceptance evidence.
`06-verified-efficiency-control-plane.md` owns the broader efficiency control
model, lifecycle attribution, actuator contracts, and policy-promotion gates.

## Goals

- Bound research-turn token volume without weakening source quality.
- Attribute research cost by source before compaction or budgeting changes.
- Preserve citations, tool metadata, and cross-surface traceability.
- Reuse roadmap `06` measurement and control primitives instead of creating a
  separate research-only policy engine.

## Sequel Standards

- No prompt-only quick fixes or model-specific hacks.
- No silent evidence dropping.
- No ungrounded summaries replacing primary-source evidence.
- No research budgeting implementation before attribution and verification
  evidence exist.

## Trigger

During 2026-06-29 live GUI validation with `codex-oauth/gpt-5.5`, a research
turn completed correctly and produced visible citations, accurate tool events,
and a clean `completed` outcome. However, the turn consumed 565,377 input
tokens, 7,646 output tokens, and 433,152 cache-read tokens for one prompt.

The remaining debt is not failed execution. It is excessive research-turn
context volume and insufficient budget instrumentation for long-form research
workflows.

## Scope

- Runtime context budgeting for research-only turns.
- Tool result compaction before model replay.
- Web search/extract result summarization and deduplication.
- Repository inspection result compaction for `grep`, `read`, `read_many`,
  `tree`, and resource reads.
- Continuity artifact selection so completed research turns do not overfeed
  later turns.
- Cross-surface token/cost visibility for GUI, CLI, TUI, and managed-agent
  invocations.
- Per-turn evidence ledgers that preserve inspectability without replaying all
  raw evidence into the next model call.

## Non-Goals

- No global token minimization at the expense of research quality.
- No prompt-only quick fix.
- No provider-specific hidden truncation.
- No separate research policy owner outside roadmap `06` control-plane
  contracts.

## Constraints

- Do not hide evidence by dropping citations, tool metadata, or transcript
  events.
- Do not add prompt-only quick fixes or model-specific hacks.
- Do not silently degrade research quality by replacing primary-source
  extraction with ungrounded summaries.
- Keep behavior cross-surface and cross-harness: GUI, CLI, TUI, and managed
  agents must share the same budgeting semantics.
- Preserve source URLs in user-facing answers when web tools inform the result.
- Preserve accurate tool counts in continuity artifacts and session summaries.

## Required Evidence

- Reproduce a research turn that currently exceeds the target token envelope.
- Attribute token volume by source:
  - projected session/context artifacts;
  - prior transcript replay;
  - web search/extract outputs;
  - repository inspection outputs;
  - tool summaries;
  - model-facing procedural instructions.
- Add regression tests for the chosen compaction boundary.
- Prove completed research turns still expose:
  - exact source URLs;
  - accurate tool counts;
  - tool metadata in transcript/session evidence;
  - no governed work-item materialization for research-only prompts.
- Run targeted runtime/gateway tests and repository typecheck.

## Research Basis

The initial workload is the 2026-06-29 GUI research turn that consumed 565,377
input tokens, 7,646 output tokens, and 433,152 cache-read tokens while still
producing a correct, cited answer. Roadmap `06` now owns the wider efficiency
control-plane research and must supply the attribution primitives this roadmap
depends on.

## Delivery Slices

1. Reproduce or replace the 2026-06-29 research workload with a stable fixture.
2. Attribute research-turn tokens by lifecycle source using roadmap `06`
   primitives.
3. Define the canonical research evidence budget and compaction boundary.
4. Add cross-surface projections for measured, estimated, cached, and avoided
   research-token volume.
5. Promote stable doctrine into architecture and guides after verification.

## Promotion Gates

Promote this roadmap to active when live validation, release confidence, or
provider quota pressure requires reducing research-turn token volume. The
implementation should start from measured token attribution, then introduce a
canonical research evidence budget instead of adding ad hoc truncation.

## Verification

- Reproduce or replace the original workload with an equivalent committed
  research-turn fixture.
- Attribute token volume by lifecycle source.
- Prove exact source URLs, tool counts, transcript/session evidence, and
  research-only work-item behavior are preserved.
- Run targeted runtime/gateway tests and repository typecheck.

## Completion Criteria

This roadmap closes when research-heavy turns have a canonical evidence budget
that reduces avoidable model-facing volume while preserving source quality,
citations, traceability, and cross-surface parity.
