# Skill Catalog Governance, 2026

## Status

This note records the evidence behind Kiln's cross-harness skill-catalog
visibility work. It supports Roadmap 05 and does not make a public benchmark
claim. Harness behavior is version-sensitive; native capability must be
reported from resolved evidence rather than assumed from this document.

## Incident

A real Codex session warned that skill descriptions had been shortened to fit
the skills context budget. A repeatable read-only inventory on 2026-08-12 found
approximately 130 visible skill entries, 123 unique names, and 43,515 UTF-8
description bytes before catalog names, paths, aliases, and instructions.
The largest contributions were a shared agent-skill root and the broad set of
user skills admitted by Kiln. Kiln's compact core built-ins were a small
minority of the catalog.

The warning was not evidence that Codex had omitted skills. The inspected Codex
renderer retained all names and emitted the warning when aggregate description
truncation exceeded its threshold. The renderer allocated two percent of the
resolved model context to skill metadata. This is implementation evidence for
the inspected Codex version, not a stable cross-harness constant.

The inspected Codex clone was revision
`32329b289d05eb6a3f8e35c267ceb25ba46716a2` (2026-07-24). Its extension
renderer additionally capped the two-percent allocation at 4,000 approximate
tokens, limited an individual description to 1,024 characters, and used a
four-bytes-per-token approximation. The core renderer did not apply that
4,000-token cap. Kiln therefore records exact bytes independently from native
budget evidence and must attach a harness revision to any limit it reports.

The same inventory found seven active duplicate names. Five were independent
overlaps between canonical Kiln user skills and the shared user `.agents`
catalog; `pdf` overlapped a shared skill and an enabled plugin, and
`skill-creator` overlapped a shared skill and a Codex system skill. Repeated
Kiln projections across Codex, Claude Code, and OpenCode are expected copies,
not independent ownership conflicts. Inventory must model that relationship so
it does not inflate collision counts.

## External Evidence

OpenAI recommends exposing only tools relevant to the task and keeping their
descriptions concise. In a sample of internal coding-agent evaluations, leaner
system prompts improved scores by roughly 10–15 percent while reducing total
tokens by 41–66 percent and cost by 33–67 percent. OpenAI labels these ranges
directional and recommends validation on representative application tasks:
<https://developers.openai.com/api/docs/guides/latest-model>.

Anthropic reports that on-demand tool discovery reduced initial tool-context
consumption by 85 percent in its example while preserving access to the full
library. Its internal MCP evaluations also improved when only relevant tool
definitions were expanded:
<https://www.anthropic.com/engineering/advanced-tool-use>.

AgentSkillOS evaluated catalogs from 200 to 200,000 skills. Its experiments
found that tree-based retrieval approximated oracle selection and that
structured orchestration outperformed flat invocation over the same skill set:
<https://arxiv.org/abs/2603.02176>.

A separate 2026 study evaluated retrieval from 34,000 real-world skills. Skill
benefits degraded as discovery conditions became more realistic; query-specific
retrieval and refinement improved Terminal-Bench 2.0 pass rate from 57.7 to
65.5 percent in the reported experiment:
<https://arxiv.org/abs/2604.04323>.

BiasBusters found provider and position bias in flat tool catalogs. Semantic
alignment between a task and tool metadata was the strongest predictor of
selection, description changes shifted choices, and filtering to a relevant
candidate subset reduced bias while preserving coverage:
<https://www.microsoft.com/en-us/research/publication/biasbusters-uncovering-and-mitigating-tool-selection-bias-in-large-language-models/>.

## Native Harness Evidence

The supported harnesses do not expose one timeless visibility API.

| Harness | Implicit discovery | Explicit-only mechanism | Disabled mechanism |
| --- | --- | --- | --- |
| Codex | Skill appears in the model-facing catalog. | `agents/openai.yaml` with `policy.allow_implicit_invocation: false` in the inspected source. | Native skill configuration can disable an exact path or name. |
| Claude Code | Description appears in the session catalog. | `disable-model-invocation: true` keeps the description out of model context while preserving manual invocation. | Current settings expose per-skill visibility overrides. |
| OpenCode | The native `skill` tool advertises permitted skills and loads bodies on demand. | Newer V2 documentation defines `metadata.opencode/autoinvoke: false`; compatibility must be version-proven before projection is called exact. | Skill permission `deny` hides and rejects the skill. |

Claude Code evidence:
<https://code.claude.com/docs/en/slash-commands>.
OpenCode stable skill and permission evidence:
<https://opencode.ai/docs/skills/>.
OpenCode V2 visibility evidence:
<https://opencode.ai/v2/docs/skills>.

Kiln must therefore distinguish canonical intent from native realization. An
adapter may report an exact translation, a lossy translation, or an unsupported
capability. It must not silently broaden `explicit-only` into implicit model
discovery.

## Decision

Kiln owns three provider-neutral catalog visibility states:

- `implicit`: the harness may advertise the skill to the model for automatic
  selection.
- `explicit-only`: the skill remains installed and directly invocable, but its
  routing description must not occupy the model's default catalog.
- `disabled`: the skill is unavailable and Kiln removes only projections it can
  prove it owns.

Catalog visibility is separate from `skills.selection.mode`. Visibility governs
native harness discovery. `advisory` versus `auto` governs whether Kiln admits a
recommended skill body into a managed task after registry and policy checks.
Neither contract grants tool authority.

The initial visibility default remains `implicit` for compatibility. Exact
skill-id overrides allow global Sequel policy to move specialist skills to
`explicit-only` and obsolete skills to `disabled`. The initial policy is
global-only: supported native directories are user-global, so project-level
visibility would create last-sync-wins behavior across repositories. Scoped
project policy remains unavailable until harness adapters have scoped targets.

Native projections require harness-specific renderers. Copying the same skill
package byte-for-byte to every harness is insufficient because provider
metadata has different locations and semantics. Status must expose desired
visibility, effective native visibility, translation support, and the reason
for any loss of capability.

Catalog evidence uses portable logical source ids and a digest of the complete
skill package. Discovery collects every candidate before applying precedence.
The resolved registry remains project Kiln source over user Kiln source over
built-in; shared `.agents`, plugin, system, and unmanaged native sources remain
diagnostic-only until explicitly adopted. Identical package digests are
equivalent duplicates; the same canonical name with different package digests
is a divergent collision; case-only name differences are reported separately.

Exact UTF-8 description bytes are the initial portable cost measure. Kiln does
not convert bytes or characters into an authoritative token count. Native
limits, operator thresholds, tokenizer results, and estimates are separate
evidence authorities, and utilization remains unknown when their units or
subject versions cannot be compared.

Config-status evidence version 2 exposes only a bounded catalog summary on
shared status/setup surfaces: completeness, duplicate and collision counts,
per-harness implicit description bytes, budget authority, and at most twelve
actionable projection or capability issues. The dedicated `skills` view remains
the detailed candidate, resolution, admission, and projection surface. Summary
evidence carries total and omitted issue counts so truncation is explicit on
CLI, doctor, GUI, and TUI surfaces.

## Ordered Delivery

1. Define canonical visibility and per-harness projection evidence.
2. Render explicit-only and disabled behavior through capability-aware native
   adapters while preserving drift and ownership checks.
3. Inventory shared `.agents` roots and plugin-contributed catalogs without
   silently admitting them.
4. Report context cost, duplicates, shadowing, and budget authority per harness.
   Unknown tokenization, context windows, or version-specific limits remain
   unknown rather than estimated as fact.
5. Add task-routing evaluations before changing the default visible set for all
   operators.

## Verification Standard

Every visibility change requires:

- config validation and global/project merge tests;
- native projection tests for Codex, Claude Code, and OpenCode;
- disabled-skill pruning and drift-preservation tests;
- shared status-schema and surface projection tests;
- a fresh-session smoke showing that catalog warnings are absent where a native
  harness exposes them;
- representative routing tests proving that implicit skills remain discoverable
  and explicit-only skills remain directly invocable;
- focused package tests, workspace typecheck, and `git diff --check`.

No catalog-size or efficiency claim is promoted from a single operator
inventory. Public claims require the benchmark contract in
[`../architecture/quality/benchmark-validation.md`](../architecture/quality/benchmark-validation.md).
