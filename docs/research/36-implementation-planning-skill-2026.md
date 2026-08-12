# Implementation Planning Skill Research

Status: accepted implementation basis for the native `implementation-planning`
skill.

## Question

Implementation plans can reduce risk in interdependent repository work, but they
can also waste time, conceal unresolved decisions, or fabricate precision. The
question is when planning is justified and what makes a plan executable,
verifiable, recoverable, and safe to revise.

## Sources

- Bairi et al., *CodePlan: Repository-level Coding using LLMs and Planning*,
  FSE/PACMSE 2024: <https://arxiv.org/abs/2309.12499>
- Xia et al., *Agentless: Demystifying LLM-based Software Engineering Agents*,
  FSE 2025: <https://arxiv.org/abs/2407.01489>
- Feng et al., *LongCLI-Bench*, Findings of ACL 2026:
  <https://aclanthology.org/2026.findings-acl.1497/>
- Sun et al., *Agent Planning Benchmark*, 2026 preprint:
  <https://arxiv.org/abs/2606.04874>
- Zhou et al., *SWE-RPG*, 2026 preprint:
  <https://arxiv.org/abs/2608.09072>
- Google Engineering Practices, Small CLs:
  <https://google.github.io/eng-practices/review/developer/small-cls.html>
- DORA, Working in small batches:
  <https://dora.dev/capabilities/working-in-small-batches/>
- Anthropic, Building effective agents:
  <https://www.anthropic.com/engineering/building-effective-agents>
- GitHub Spec Kit, evolving specifications:
  <https://github.github.com/spec-kit/guides/evolving-specs.html>
- Google SRE Workbook, canarying releases:
  <https://sre.google/workbook/canarying-releases/>

Sources were checked through 2026-08-12. Papers and industrial guidance are
bounded evidence; none validates Kiln's exact plan format.

## Findings

Planning helps most when changes are interdependent. CodePlan used incremental
dependency and impact analysis to adapt a chain of repository edits; it passed
validity checks on five of six repositories while comparable no-planning
baselines passed none. The tasks spanned 2--97 files, but only two task families
and six repositories were studied, so the result does not justify mandatory
planning for every edit.

Long-horizon execution remains brittle. LongCLI-Bench contains 20 sequential
engineering tasks; evaluated agents remained below 20% pass rate and most stalled
before 30% completion. Human plan injection and interactive guidance improved
results more than self-correction. The 2026 Agent Planning Benchmark separately
measures planning errors and reports improved downstream execution after
plan-focused refinement on 400 transferred tool-use tasks. These results support
inspectable and revisable plans, not a claim that a first plan is authoritative.

Requirement uncertainty is a planning input, not implementation detail. The very
recent SWE-RPG preprint covers 163 Python and Java tasks and reports implicit
requirement recovery as a leading failure source. Because it is a new preprint
with assisted ground truth, Kiln uses it only to reinforce a conservative rule:
surface material choices instead of hiding them in a complete-looking sequence.

Established engineering guidance converges on coherent small batches. Google
requires self-contained conceptual changes and valid intermediate states, with
dependency order made explicit for stacked changes. DORA associates small
batches with delivery performance and course correction but provides no universal
file or line threshold. SRE rollout guidance adds verification between stages and
real recovery for stateful change. Therefore a slice is atomic by behavior and
recoverability, not by arbitrary size.

Agent guidance also argues against ritual process. Anthropic recommends starting
with the simplest system and notes that complex multi-file work cannot always
predict every required file in advance. Agentless demonstrates that an explicit,
simple localize--repair--validate workflow can remain competitive without
elaborate orchestration. Plans should distinguish confirmed paths from candidates
and be refreshed when execution reveals new evidence.

## Decision

Kiln's planning procedure is conditional. Use it for scoped work with meaningful
interdependence, boundary reach, uncertainty, or risk; use a short execution note
for one obvious low-risk edit.

A professional plan must:

- state the outcome, acceptance evidence, and non-goals;
- expose blocking decisions, assumptions, and unknowns;
- distinguish confirmed repository surfaces from candidates;
- split work into coherent, safe intermediate states;
- order dependencies and restrict parallelism where ownership overlaps;
- attach an expected verification signal and relevant recovery to each slice;
- include broader gates only when justified by the impact surface; and
- be re-scouted and revised when its premises become stale.

The skill governs plan content, not lifecycle authority. Kiln's structured plan,
approval, work-item, and execution contracts remain authoritative where present.

## Forward Evaluation

After rebuilding and syncing the revised skill, a fresh read-only planner was
given a prospective Kiln change: add a `manual` skill-selection mode that suppresses
automatic recommendations while preserving explicit invocation. The planner had
no expected file list or solution.

The resulting artifact:

- distinguished `manual` from the existing diagnostic-only `advisory` mode;
- preserved native skill visibility as a separate contract;
- grounded exact config, selector, caller, test, and documentation surfaces in
  repository evidence;
- exposed the recommendation-diagnostic behavior as the key semantic risk;
- ordered failing tests before config and selector changes;
- kept explicit invocation on the existing shared resolution path;
- attached focused completion signals and recovery to each slice; and
- avoided changes to the registry, visibility adapters, provider routing, and
  event contracts without causal evidence.

This is one qualitative forward evaluation, not a benchmark or automated
regression suite. The Core test protects the durable prompt contract; future
cross-model and adversarial evaluations remain the behavioral evidence surface.

## Non-Goals

- Do not require elaborate planning for every edit.
- Do not convert a scout map into a speculative file checklist.
- Do not resolve product, architecture, security, or data-loss choices by prose.
- Do not use generic testing, documentation, rollback, or full-suite steps.
- Do not treat a plan as write authority, approval, or completion evidence.
