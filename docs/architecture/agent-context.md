# Agent Context

Agent context is Kiln's canonical model for operator identity, instruction
doctrine, executable agent profiles, reusable skills, and managed child context.
It is part of the control plane's context-governance boundary. It is not a
single prompt string and not a native-harness compatibility layer.

## Doctrine

Kiln controls agent behavior by assembling high-signal context from scoped,
typed, auditable sources. Each source has provenance, precedence, budget cost,
and admission rules. Context enters the model only after policy and budget
admission.

The canonical mistake to avoid is merging everything into "personality." An
operator identity, an engineering standard, a role-specific worker prompt, a
skill, and a managed child boundary have different ownership and safety
semantics. They may be assembled together for one model call, but they remain
different contracts.

Work governance is a separate contract from identity, instruction profiles,
agent profiles, and skills. It decides the default posture for operator work:
direct execution only for small low-risk tasks, orchestration for non-trivial
work, and evidence required before closeout. Instruction profiles may express
team doctrine, but the cross-surface policy lives in resolved
`workGovernance` config and is projected as required context.

## Canonical Surfaces

| Surface | Purpose | Native or personalizable |
| --- | --- | --- |
| `OperatorIdentity` | Operator metadata for prompt context and UI personalization. | Native schema, personal content. |
| `InstructionProfile` | Durable doctrine: standards, preferences, policies, principles. | Native precedence/admission, personal/team content. |
| `WorkGovernancePolicy` | Default posture, direct-execution envelope, delegation triggers, and evidence expectations. | Native schema, global/project values. |
| `AgentProfile` | Executable role configuration for parent agents, subagents, and managed children. | Native schema/admission, personal/team definitions. |
| `SkillPackage` | Reusable procedural context, references, scripts, and resources. | Native registry/admission, personal/team/community packages. |
| `WorkClassification` | Cross-domain work intent, artifact, domain, effect, and mode facets used for diagnostics and governed skill recommendation. | Native schema, per-invocation/session values. |
| `ManagedInvocationContext` | One admitted child-run context assembled from profile, skills, resources, route, and authority. | Native runtime contract. |

## Operator Identity

Operator identity is not a full workflow doctrine, but it must be rich enough
for Kiln to understand who the operator is and how the operator expects work to
be conducted. A poor identity surface produces generic assistants even when the
rest of the runtime is powerful.

It may include:

- name
- timezone
- locale or preferred language
- UI preferences
- short communication preferences
- organization and project roots
- preferred review posture
- preferred collaboration style
- default escalation expectations

It must not include broad architectural doctrine, route authority, tool
permissions, or agent role behavior. Those belong to instruction profiles,
routes, permissions, or agent profiles.

Kiln accepts global `identity.name` and `identity.timezone` and projects them
as required `instruction` context blocks with provenance through the
`DefaultContextGovernor`. Identity values are not appended as passive prompt
text and are not allowed to become broad workflow doctrine.

## Instruction Profiles

Instruction profiles hold durable doctrine such as:

- Sequel engineering standards
- project architecture rules
- testing and verification policy
- communication preferences
- default workflow and delegation protocol
- review gates and quality bars
- preferred planning, scouting, TDD, and implementation sequence
- product principles
- organization security policy

Instruction profiles are not executable agents. They are high-precedence
context sources that shape agent behavior across surfaces. They should be
stored as scoped documents or references, not repeated inside every agent
definition.

Canonical instruction profiles live in `~/.kiln/instructions/*.md` and
`.kiln/instructions/*.md`. The file format is markdown with YAML
frontmatter:

```markdown
---
name: sequel-engineering
displayName: Sequel Engineering
description: Engineering standards and collaboration doctrine.
tags:
  - engineering
doctrine:
  principles:
    - No dead code.
    - No redundancy.
    - Respect DDD and Clean Architecture boundaries.
  workflow:
    - Scout before broad or architecture-sensitive changes.
    - Use TDD for behavior changes when practical.
  qualityGates:
    - Run focused checks before broad gates.
    - Verify before claiming complete.
  reviewPosture:
    - Findings before summaries.
    - Treat missing tests and boundary drift as real risks.
  delegation:
    - Use specialist child profiles for architecture, TDD, implementation, and review when the task crosses boundaries.
---

No dead code. No redundancy. Use Clean Architecture boundaries. Verify before
claiming complete.
```

Global `activeInstructionProfiles`, project `activeInstructionProfiles`, and
agent `instructionProfiles` select profiles by stable id. Project profiles
override global profiles with the same id. Selected profiles fail closed when
the referenced canonical profile cannot be found.

An instruction profile is the place where Kiln carries an operator or team's
working "soul": standards, habits, taste, non-negotiables, and expected
workflow. This must be canonical Kiln state, not a one-off `AGENTS.md` prompt
that only one harness happens to read.

The markdown body is the human-readable doctrine. The optional `doctrine`
frontmatter is the structured surface contract. It lets GUI, TUI, CLI, SDK,
managed invocation, and native harness projections expose principles,
workflow, quality gates, review posture, and delegation rules without parsing
freeform prose. Surfaces may summarize these facets, but they must not invent
new doctrine outside the canonical profile.

## Agent Profiles

Agent profiles describe executable roles. A valid profile declares:

- stable id and display name
- role
- goal
- tier: reasoning, coding, or fast

A profile may also declare:

- description
- nickname candidates or aliases for operator-facing surfaces
- backstory
- instructions
- preferred provider/model route
- task affinity hints such as `architecture-review`, `backend-coding`,
  `frontend-design`, `mechanical-edit`, `research`, and `test-writing`
- mode: primary, subagent, managed-child, or all
- allowed tools or permission profile
- default skills
- default instruction profiles
- managed authority profile constraints

Profiles do not own credentials. They may request a provider route, but runtime
credential routing remains a provider/credential-pool responsibility.

Profiles also do not automatically imply read-only execution. A profile may be
eligible for different managed authority profiles depending on context: scout
and reviewer profiles may default to read-only, while coder, fast-coder, TDD,
or refactoring profiles may request write-capable child authority when the
parent session and operator approval admit it.

Every surface must consume the same profile contract:

- GUI selected assistant
- TUI selected assistant
- CLI `kiln run --agent`
- SDK/widget session configuration
- managed child invocation
- native harness projection

Agent `instructionProfiles` are references, not copied doctrine. They select
additional canonical instruction profiles for that agent when the profile is
used by `kiln run --agent` or managed child invocation.

Agent `taskAffinity` is advisory selection evidence. It helps parent sessions
choose an appropriate configured child for natural-language delegation, but it
does not grant tools, credentials, filesystem access, or write authority.
Kiln must not infer hidden task affinity from profile names; if a profile needs
task-selection behavior, declare it explicitly in the canonical agent profile.

Surface-specific renderers may project smaller views, but they must not invent
local semantics.

## First-Party Agent Defaults

Kiln ships first-party agent profile defaults so a new installation is not an
empty control plane. These defaults are canonical Kiln profiles, not provider
prompt hacks. They use stable ids, explicit task affinity, bounded tool hints,
and role-specific instructions that are safe to project into GUI, TUI, CLI,
SDK/widget sessions, managed child invocation, Codex, OpenCode, and Claude Code
repo shims.

The built-in profile ids are:

| Profile | Purpose | Typical authority |
| --- | --- | --- |
| `scout` | Read-only codebase/context mapping. | `foundation-readonly-plan` |
| `planner` | File-level implementation and verification planning. | `foundation-readonly-plan` |
| `architect` | Architecture, DDD, contract, and boundary review. | `foundation-readonly-plan` |
| `tdd` | Failing-test design and behavior verification. | Read-only or write-capable when admitted. |
| `coder` | Bounded implementation after scope is clear. | Write-capable only through explicit route authority. |
| `fast-coder` | Mechanical low-risk edits and projections. | Write-capable only through explicit route authority. |
| `reviewer` | Findings-first code review and quality gate. | `foundation-readonly-plan` |
| `ddd-validator` | Bounded-context and dependency-direction validation. | `foundation-readonly-plan` |
| `researcher` | Evidence gathering and source separation. | `foundation-readonly-plan` plus admitted research tools. |
| `refactoring-specialist` | Behavior-preserving cleanup and simplification. | Read-only or write-capable when admitted. |

Global `~/.kiln/agents/*.md` profiles override built-ins with the same id.
Project `.kiln/agents/*.md` profiles override both. This keeps first-party
defaults useful while preserving operator and project customization without
duplicating native harness files.

First-party defaults are evaluated by a repeatable routing rubric before they
become product defaults. The rubric checks output quality, evidence use,
permission compliance, cost, duration, and actionable handoff quality. Defaults
that cannot pass the rubric remain documentation or examples, not runtime
catalog entries.

## Skill Packages

Skills are reusable procedural context. They may include:

- `SKILL.md` instructions
- references
- templates
- scripts
- assets
- compatibility metadata
- trust/provenance metadata
- required environment or tool capabilities

Skills are loaded progressively. The model may see a bounded skill index first
and load full skill content only when needed and admitted. Full skill content
is subject to context budget.

`SkillRegistry` discovers and caches metadata indexes without materializing
instruction bodies. Governed task selection loads only exact admitted skill
names and records a path-free `progressive-skill-projection-v1` evidence record:
catalog, selected, and deferred counts; metadata, selected-context, and avoided
source bytes; estimated selected tokens; explicit or automatic selection
reason; and filesystem or memory-cache materialization source. The evidence
hash is stable for the selected names and reasons and does not expose local
paths or unselected instructions.

Skills are not permissions. A skill may teach an agent how to use a tool, but
tool authority still comes from Kiln's tool and managed invocation policy.
Agent default skills are resolved through `SkillRegistry`, loaded as governed
procedural context, and fail closed when a referenced skill is unavailable.
Task/model recommended skills are advisory by default. When
`skills.selection.mode: auto` is configured, Kiln may load recommended skills
for the selected route, route suitability task, or explicit work
classification after the same registry admission check. Auto-selected skills
do not grant tool authority and are recorded as admitted procedural context.

`WorkClassification` is the cross-domain classification contract. It is not a
model/provider suitability enum and must not grow into a software-only task
list. It records explicit facets:

- intents: `write`, `edit`, `summarize`, `explain`, `research`, `analyze`,
  `plan`, `review`, `decide`, `support`, `teach`, `translate`, `code`,
  `design`, or `operate`.
- artifacts: `prose`, `code`, `ui`, `data`, `document`, `message`, `slide`,
  `spreadsheet`, `image`, `audio`, `workflow`, or `configuration`.
- domains: `software`, `business`, `education`, `support`, `marketing`,
  `legal`, `regulatory`, `finance`, `medical`, `operations`, or
  `personal-productivity`.
- effects: `answer-only`, `read-only`, `write-artifact`, `mutate-workspace`,
  `execute-command`, `external-side-effect`, or `publish-send`.
- modes: `answer`, `coauthor`, `transform`, `critique`, `delegate`,
  `automate`, or `monitor`.

Unknown explicit work classification facets fail closed. Supported facets may
recommend skills such as `clear-writing`, but only configured skills can be
admitted and only when the selected policy allows auto-selection. Work
classification is recorded in managed invocation context metadata so GUI, TUI,
CLI, SDK/widget, and replay surfaces can explain why a skill was recommended
or omitted without parsing the prompt.

Every work-recommended skill records a diagnostic state:

- `admitted`: the skill was recommended by work classification and admitted by
  the configured registry and `skills.selection.mode: auto`.
- `advisory`: the skill was recommended, but auto selection is disabled; the
  recommendation remains diagnostic evidence.
- `unavailable`: auto selection is enabled, but the skill is not present in
  the governed Kiln registry and is not silently invented or imported from a
  native harness.

Approved plan work items are the durable authority for governed
classification. When a plan proposes a classified work item, Kiln stores the
normalized `WorkClassification` together with
`WorkClassificationProvenance { sourceKind: "plan-work-item", sourceId }`.
Both fields are required together, both participate in the plan content hash,
and a revised classification supersedes prior approval. Materialization copies
the pair into the durable `WorkItem`; re-materialization fails closed if an
existing work item has different classification or provenance. A managed
invocation generated for that work item carries the stored classification into
the request, and canonical session events record requested, resolved, and
recommended work-classification metadata for replay.

Kiln does not infer durable classification from prompt text. Existing
unclassified work remains explicitly unclassified until an approved plan,
governed `work_item.update` call, agent profile, or explicit managed
invocation supplies a validated classification. Invocation-supplied
classification takes precedence over agent-profile defaults. If a caller
supplies an unknown explicit facet, the request fails closed before skill
recommendation or child execution.

Skill existence is not the same as admission. The canonical skill status model
tracks these states separately:

- configured: a skill exists in Kiln's governed registry from project, user,
  plugin, or built-in source.
- origin: `project`, `user`, `plugin`, `builtin`, or `native-harness`.
- projected: Kiln has written the configured skill to a supported native
  harness skill directory and install-state can prove the projection is
  current.
- unmanaged native: a supported harness has a local skill file that Kiln did
  not configure or project.
- stale or drifted projection: install-state proves Kiln once managed the
  projection, but the native file is missing or changed.
- admitted: the skill content entered this operator session or managed child
  context through explicit request, agent profile defaults, or auto selection.
- omitted: the skill is configured but not selected for the current route,
  profile, task, selection mode, or context budget.
- blocked: policy, route capability, profile, or drift prevents use.
- unavailable: an explicit skill reference cannot be resolved through the
  governed Kiln registry.

Unknown explicitly requested skills fail closed. Native harness-local skills
outside Kiln start as diagnostics only: Kiln may report that Codex, OpenCode,
or Claude Code can see a local `SKILL.md`, but it must not silently admit that
content into a managed invocation or operator context. The governed repair is
explicit adoption: setup may copy non-conflicting native skills into canonical
Kiln user config, then project the same canonical copy back to every supported
harness. If the same skill name has different native contents across harnesses,
adoption blocks for manual reconciliation instead of choosing a winner.

## First-Party Skill Defaults

Kiln ships a small first-party core skill pack so the default system has useful
procedural behavior without importing an operator's personal doctrine. Built-in
skills are neutral product content, not Sequel-specific standards and not a
replacement for operator instruction profiles.

The built-in skill ids are:

| Skill | Purpose | Typical agents |
| --- | --- | --- |
| `repo-context-review` | Validate generated project context and repo shims against repository evidence. | `scout`, `architect` |
| `codebase-scouting` | Map affected files, dependencies, boundaries, and risks before broad changes. | `scout` |
| `implementation-planning` | Convert a scoped objective into file-level sequence and verification gates. | `planner`, `architecture-planner` |
| `tdd-workflow` | Design failing tests, implement only the target behavior, and verify. | `tdd`, `coder` |
| `code-review-findings` | Perform findings-first review with severity, evidence, and test-gap risk. | `reviewer`, `adversarial-reviewer` |
| `clean-architecture-boundary-review` | Detect dependency direction, port/adapter, layer, and surface ownership drift. | `architect`, `ddd-validator` |
| `ddd-boundary-review` | Review bounded contexts, aggregate ownership, language leakage, and coupling. | `ddd-validator`, `architect` |
| `refactoring-safety` | Preserve behavior while removing dead code, redundancy, and avoidable complexity. | `refactoring-specialist` |
| `security-scope-review` | Review authority, secrets, prompt/tool injection, and unsafe execution scope. | `adversarial-reviewer`, `reviewer` |
| `managed-agent-risk-review` | Audit child invocation authority, route identity, handoff, replay, and evidence. | `architect`, `reviewer` |
| `benchmark-readiness-review` | Decide whether eval or benchmark evidence is reproducible and public-ready. | `researcher`, `reviewer` |
| `config-projection-review` | Review canonical config, generated shims, native projections, drift, and setup state. | `scout`, `architect` |
| `clear-writing` | Write, rewrite, or review prose so it is clear, accurate, structured, and audience-appropriate. | Any writing or review agent |

Built-ins are the lowest precedence tier. Project skills override user skills;
user skills override built-ins. A project or user may disable built-ins or
select an allowlist through `skills.builtin`. Unknown skills still fail closed.

First-party built-ins must remain compact, vendor-neutral, removable, and
evaluated. A general writing-quality skill may be native when it is useful
across domains, preserves stricter brand/legal/regulatory formats, and does
not encode a company voice. Framework-specific, regional, brand, or
opinionated packs belong outside core. Future official packs such as web,
backend, security, or an opinionated engineering pack may be installable
content, but they must not become default product doctrine unless promoted
through the same evaluation and documentation gate.

## Managed Child Context

A managed child receives an admitted child context, not the parent's ambient
authority and not the full parent transcript by default.

When the child is executing or reviewing a governed work item, the admitted
context also carries the explicit handoff contract from the parent work item:
`workItemId`, `roleIntent`, `expectedEvidence`, `requiredResultFields`,
`doneCriteria`, and `residualRiskRequired`. These fields make the child task
traceable and reviewable, but they do not grant tools, credentials, write
access, or authority profile changes.

If the work item has durable work classification, the generated managed
invocation request includes that classification. The context resolver may then
return resolved classification and work-recommended skills after normal
registry admission. Session events preserve the requested classification,
resolved classification, and recommendation list in `invocationContext`, so an
operator can replay why `clear-writing` or another skill was admitted,
recommended, skipped, or omitted.

Default child context mode is `isolated`. The runtime may admit additional
context through:

- explicit task text
- selected agent profile
- selected instruction profiles
- admitted skills
- explicit work classification diagnostics
- resource URIs
- governed memory/context candidates
- minimal environment facts
- route and authority metadata

Supported context modes:

| Mode | Meaning |
| --- | --- |
| `isolated` | Child gets only explicitly assembled context. Default. |
| `resources` | Child gets explicit `kiln://` resources plus profile and skills. |
| `fork` | Child gets a governed branch of parent context. Requires policy admission. |

`fork` is not a shortcut for lazy prompting. It is for genuinely context-bound
delegation where restating the necessary context would be lossy or expensive.
The current CLI-owned managed invocation resolver rejects `fork` until explicit
fork admission policy is implemented.

## Native Versus Personalizable

Native Kiln behavior:

- schemas for identity, instruction profiles, agent profiles, skills, and child
  context
- scope resolution and precedence
- context governor admission
- skill discovery and admission
- managed child profile/skill/context admission
- event evidence and replay references
- surface parity across GUI, TUI, CLI, SDK/widget, App Gateway, and Operator
  Gateway
- native harness projection from canonical Kiln state

Personalizable behavior:

- actual operator preferences
- actual instruction profile content
- agent definitions
- installed skills
- enabled or disabled first-party built-in skills
- per-agent skill allowlists
- route/model preferences
- project-local overrides
- whether specific community packs are installed

Community packs, prompt libraries, and "agent teams" are content. Kiln may
install or project them, but they are not product doctrine until converted into
canonical Kiln contracts.

## Precedence And Admission

Resolution order:

1. Managed policy or organization doctrine
2. Project doctrine
3. Project-local scoped overrides
4. User/operator defaults
5. Agent profile defaults
6. Session mode and explicit user request
7. Managed invocation request

Higher-precedence safety rules always win. Lower-precedence sources can narrow
authority, add task context, or request a profile/skill/route when policy allows
it.

Every admitted context block must record:

- source kind
- source id or path
- scope
- precedence
- token estimate
- admission reason
- denial reason when rejected

## Surface Parity

No surface owns agent context semantics.

- GUI renders profile, route, skill, and context evidence.
- TUI renders the same evidence in terminal form.
- CLI prints and records the same selected profile/skills/route.
- SDK/widget receives the same session event contract.
- MCP/resources expose the same replayable artifacts.
- Native harness sync projects from Kiln contracts only.

If a surface cannot display the full detail inline, it must expose a resource
or detail view rather than dropping the evidence.

Managed child invocation events carry requested and admitted child context:
context mode, agent profile, skills, instruction profiles, provider route,
work classification, model, adapter, execution mode, authority profile,
invocation id, child session, and child turn. General operator identity and
instruction profiles are available through the context governance audit as
`instruction` blocks.

The model-facing `managed_agent.invoke` tool description projects a bounded
catalog of admitted routes, profiles, task-suitability evidence, configured
skills, native-only skill diagnostics, context-mode rules, and unavailable-route
diagnostics. Long catalogs are summarized with omitted counts so a diagnostic
request does not consume the whole child-invocation context. This lets an
operator ask for delegated work naturally while the parent model still chooses
only from admitted ids. Unknown agent profiles or skills fail closed.

Skill diagnostics use the same cross-surface contract as setup/status. GUI,
TUI, CLI, SDK/widget, and model-callable config inspection must be able to
answer: where the skill came from, whether it is built-in or user/project
content, whether it was projected to Codex/OpenCode/Claude Code, whether the
projection is missing or drifted, whether it was admitted for the current
managed invocation, and why an expected skill such as `shadcn` is unavailable.
Surfaces may abbreviate the explanation, but they must not collapse configured,
projected, native-only, and admitted into one boolean.

## Implementation Slices

The active implementation owns:

- identity as admitted `instruction` context
- instruction profile loading from global and project scopes
- agent profile loading from global and project scopes
- agent default skill admission through `SkillRegistry`
- managed child `agentProfile`, `skills`, `instructionProfiles`, and
  `contextMode` resolution
- managed orchestration preservation of each admitted agent profile, route,
  authority profile, and dependency handoff
- explicit work classification parsing, validation, skill recommendation, and
  managed invocation metadata
- native projection of canonical agent, skill, and instruction-profile
  references into harness-readable surfaces
- structured instruction-profile doctrine facets in context candidates and
  native projection summaries

## Research Inputs

- Claude Code separates scoped memory, subagents, skills, hooks, plugins, MCP,
  and settings.
- Codex separates `AGENTS.md` project instructions from skills and caps prompt
  discovery.
- OpenCode separates agents, permissions, and skills, including per-agent skill
  permissions.
- Codex's public skill documentation describes skills as reusable packages of
  instructions, resources, and optional scripts for task-specific workflows:
  <https://developers.openai.com/codex/skills>. The local Codex source also
  models skill authority, package id, enabled state, and prompt visibility
  separately (`C:\Proyectos\Sequel\cloned\codex\codex-rs\ext\skills\src\catalog.rs`).
- OpenCode's public skill documentation loads skills from repo and home
  directories, exposes them through a native `skill` tool, and allows global or
  per-agent skill permissions: <https://opencode.ai/docs/skills/>.
- Claude Code's public skill documentation covers custom and bundled skills:
  <https://docs.anthropic.com/en/docs/claude-code/skills>. The local Claude
  Code source distinguishes managed, user, project, bundled, plugin, and MCP
  skill sources (`C:\Proyectos\Sequel\cloned\claude-code\skills\loadSkillsDir.ts`).
- Everything Claude Code and Gentle AI demonstrate market demand for portable
  skill and agent catalogs, but their content must be adapted into Kiln-native
  contracts rather than copied as product identity.
- Hermes and OpenClaw show mature patterns for skill guards, progressive
  disclosure, per-agent allowlists, child isolation, and resource handoff.
- Context-engineering research supports treating context as a governed runtime
  environment optimized for relevance, sufficiency, isolation, economy, and
  provenance.
