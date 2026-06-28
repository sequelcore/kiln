# Cross-Domain Task Taxonomy Research

Date: 2026-06-28

## Question

Kiln now has a neutral `clear-writing` skill, but the current task taxonomy is
engineering-shaped. The question is whether Kiln should add a neutral task
class model so writing, editing, support, document, education, research,
business, and non-programming work can be selected and diagnosed without
pretending everything is code, research, or mechanical editing.

## Current Kiln Evidence

The current model route taxonomy is `ModelTaskSuitabilityTask` in
`packages/core/src/agents/model-capability-registry.ts`. It contains:

- `architecture-review`
- `backend-coding`
- `frontend-design`
- `mechanical-edit`
- `research`
- `test-writing`

The same file maps those tasks to recommended skills through
`recommendedSkillsForTask`. `clear-writing` is not attached to this model
because no neutral writing, editing, support, document, or communication task
exists there.

`packages/cli/src/config/task-skill-selection.ts` uses the task only for
admission of model/task recommended skills when `skills.selection.mode: auto`
is configured. Explicit skills remain fail-closed. Auto-recommended skills are
loaded only after registry resolution.

This means the current type is really a model-route suitability axis, not a
domain-neutral user-work taxonomy.

## Harness Research

### Codex

The local Codex clone separates execution workflow from skill cataloging.
`codex-rs/core/src/tasks` defines lifecycle tasks such as regular turns,
review, compact, and user shell. `codex-rs/core/src/tasks/review.rs` builds a
special review-mode sub-agent with review-specific permissions and prompt. That
is an execution mode, not a general user-intent taxonomy.

Codex skills in `codex-rs/ext/skills/src` are cataloged by authority and
visibility. `catalog.rs` models source authority, enabled state, and prompt
visibility. `provider.rs` explicitly says resources must be read through the
same provider/authority that listed them. `render.rs` bounds the visible skill
list. `selection.rs` selects enabled entries. This supports Kiln's existing
origin, projection, admission, and authority model.

Public Codex skills documentation describes skills as reusable instructions
and resources that are loaded by task relevance, not as a global task enum:
[OpenAI Codex skills](https://developers.openai.com/codex/skills).

### Claude Code

The local Claude Code clone uses surfaced skill reminders, a DiscoverSkills
tool, output styles, and subagents. In `constants/prompts.ts`, skill discovery
guidance says relevant skills are surfaced each turn and the agent should call
DiscoverSkills when the visible skills do not cover a pivot, unusual workflow,
or multi-step plan. The same prompt warns not to guess user-invocable skills.

Subagents are used when work matches the agent description. Output style is a
response-style layer, not a task ontology. This again favors description-based
matching plus explicit tool/agent authority over one flat taxonomy.

Anthropic documents the same primitives publicly:
[Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills),
[subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents), and
[output styles](https://docs.anthropic.com/en/docs/claude-code/output-styles).

### OpenCode

The local OpenCode clone has primary agents (`build`, `plan`) and subagents
(`general`, `explore`, `scout`) in
`packages/opencode/src/agent/agent.ts`. Agents are differentiated by mode,
description, tools, and permissions.

Skills are loaded from an available-skills section. In
`packages/opencode/src/session/system.ts`, the model is told to use the skill
tool when a task matches a skill description. In
`packages/opencode/src/tool/registry.ts`, the skill tool repeats the same
description-based trigger. In `packages/opencode/src/skill/index.ts`, skills
can be hidden by permission and a built-in skill can be overridden by disk
configuration.

OpenCode's public docs match the local implementation:
[skills](https://opencode.ai/docs/skills/) and
[agents](https://opencode.ai/docs/agents/). The important pattern is
permissioned availability, not automatic global admission.

### Other Local Harnesses

The smaller local harness clones did not show evidence of a mature,
cross-domain task ontology comparable to Kiln's needed control-plane role.
Where they expose work specialization, it is generally through agents, modes,
tools, permissions, or workflow prompts. No local evidence supports copying a
single universal task enum from them.

## Lab, Spec, And Paper Research

OpenAI's Agents SDK centers agents, tools, handoffs, guardrails, and tracing:
[OpenAI Agents SDK](https://openai.github.io/openai-agents-python/). The
control boundary is capability and handoff oriented.

MCP separates tools, resources, prompts, roots, and sampling rather than
compressing all work into one task class:
[Model Context Protocol specification](https://modelcontextprotocol.io/specification).

The Agent Skills specification standardizes skill packages and discovery
metadata:
[Agent Skills specification](https://agentskills.io/specification). It is a
skill packaging and client-loading contract, not a domain ontology.

Agent papers point in the same direction:

- ReAct combines reasoning traces with actions so agents can decide when to
  call tools, observe, and continue:
  [ReAct](https://arxiv.org/abs/2210.03629).
- MRKL argues for routing between neural and symbolic modules:
  [MRKL Systems](https://arxiv.org/abs/2205.00445).
- AgentBench evaluates agents across separate environments and capability
  families, not one universal task enum:
  [AgentBench](https://arxiv.org/abs/2308.03688).
- GAIA emphasizes real assistant tasks requiring reasoning, multimodality,
  tool use, and web browsing:
  [GAIA](https://arxiv.org/abs/2311.12983).
- OSWorld evaluates computer-use agents through desktop tasks:
  [OSWorld](https://arxiv.org/abs/2404.07972).
- WebArena evaluates realistic web tasks:
  [WebArena](https://arxiv.org/abs/2307.13854).
- SWE-bench evaluates real software issue resolution:
  [SWE-bench](https://arxiv.org/abs/2310.06770).
- Tau-bench evaluates tool agents in conversational, policy-constrained
  settings:
  [Tau-bench](https://arxiv.org/abs/2406.12045).

The benchmark pattern is plural: separate environments, artifacts,
permissions, tools, and success criteria. The literature does not support a
single flat enum as the long-term abstraction.

## Recommended Kiln Model

Kiln should not extend `ModelTaskSuitabilityTask` into a giant universal list.
That type should remain route/model evidence, or be renamed later to make that
boundary explicit.

Kiln should introduce a separate, canonical work classification model with
facets:

- Work intent: write, edit, summarize, explain, research, analyze, plan,
  review, decide, support, teach, translate, code, design, operate.
- Artifact type: prose, code, UI, data, document, message, slide,
  spreadsheet, image, audio, workflow, configuration.
- Domain: software, business, education, support, marketing, legal,
  regulatory, finance, medical, operations, personal productivity.
- Authority/effect: answer-only, read-only, write artifact, mutate workspace,
  execute command, external side effect, publish/send.
- Interaction mode: answer, coauthor, transform, critique, delegate,
  automate, monitor.

Those facets should feed policy, diagnostics, skill recommendations, tool
admission, agent selection, and route suitability. They should not replace
skills, profiles, permissions, or explicit operator configuration.

## Decision Guidance

Accept:

- Add a cross-domain work classification layer separate from model-route
  suitability.
- Let `clear-writing` attach to writing/editing/reviewing communication work
  through that layer.
- Keep auto-admission gated by configured policy.
- Keep explicit unknown skills and explicit unknown profiles fail-closed.
- Report inferred work facets in diagnostics so operators can see why a skill,
  tool, model, or agent was recommended or omitted.

Avoid:

- Overloading `research` or `mechanical-edit` to mean writing or document work.
- Admitting all writing skills globally because a prompt contains prose.
- Importing harness-local classifications without Kiln governance.
- Making a flat enum that must grow forever with every domain.

## Proposed Sequence

1. Rename or document `ModelTaskSuitabilityTask` as route suitability, not
   general work taxonomy.
2. Add a core `WorkClassification` value object with the five facets above.
3. Add conservative classifiers only where Kiln already has structured input:
   explicit CLI flags, agent profile metadata, managed invocation brief,
   skill metadata, and GUI/TUI setup context.
4. Add diagnostics showing inferred facets, source of inference, confidence,
   policy gate, and admitted/omitted skills.
5. Map `clear-writing` to writing, editing, reviewing, support, education, and
   document/report workflows.
6. Add tests proving that writing work recommends `clear-writing` only when
   configured/eligible, and that route suitability remains separate from work
   classification.

## Implementation Status

As of 2026-06-28, Kiln has the first governed slice of this model:

- `WorkClassification` is a core value object separate from model-route
  suitability.
- `clear-writing` recommendations are driven by work facets, not by a
  software-only route task.
- Approved plan work items may carry classification plus
  `plan-work-item` provenance. The pair is normalized, fails closed when
  incomplete or mismatched, and participates in the plan content hash.
- Materialized `WorkItem` records preserve the classification/provenance pair
  and reject idempotent conflicts.
- Generated managed invocation requests carry the durable work-item
  classification, and canonical session events preserve requested/resolved
  classification plus work-recommended skills for replay diagnostics.

Remaining work should focus on richer non-software work entry points,
operator-facing diagnostics, and any future rename of route suitability types.
