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

## Canonical Surfaces

| Surface | Purpose | Native or personalizable |
| --- | --- | --- |
| `OperatorIdentity` | Operator metadata for prompt context and UI personalization. | Native schema, personal content. |
| `InstructionProfile` | Durable doctrine: standards, preferences, policies, principles. | Native precedence/admission, personal/team content. |
| `AgentProfile` | Executable role configuration for parent agents, subagents, and managed children. | Native schema/admission, personal/team definitions. |
| `SkillPackage` | Reusable procedural context, references, scripts, and resources. | Native registry/admission, personal/team/community packages. |
| `ManagedInvocationContext` | One admitted child-run context assembled from profile, skills, resources, route, and authority. | Native runtime contract. |

## Operator Identity

Operator identity is intentionally small. It may include:

- name
- timezone
- locale or preferred language
- UI preferences
- short communication preferences

It must not include broad architectural doctrine, route authority, tool
permissions, or agent role behavior. Those belong to instruction profiles,
routes, permissions, or agent profiles.

Kiln currently accepts global `identity.name` and `identity.timezone`. The
target contract is to project admitted identity facts into prompt context and
operator surfaces with provenance instead of leaving them as passive config.

## Instruction Profiles

Instruction profiles hold durable doctrine such as:

- Sequel engineering standards
- project architecture rules
- testing and verification policy
- communication preferences
- product principles
- organization security policy

Instruction profiles are not executable agents. They are high-precedence
context sources that shape agent behavior across surfaces. They should be
stored as scoped documents or references, not repeated inside every agent
definition.

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
- mode: primary, subagent, managed-child, or all
- allowed tools or permission profile
- default skills
- managed authority profile constraints

Profiles do not own credentials. They may request a provider route, but runtime
credential routing remains a provider/credential-pool responsibility.

Every surface must consume the same profile contract:

- GUI selected assistant
- TUI selected assistant
- CLI `kiln run --agent`
- SDK/widget session configuration
- managed child invocation
- native harness projection

Surface-specific renderers may project smaller views, but they must not invent
local semantics.

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

Skills are not permissions. A skill may teach an agent how to use a tool, but
tool authority still comes from Kiln's tool and managed invocation policy.

## Managed Child Context

A managed child receives an admitted child context, not the parent's ambient
authority and not the full parent transcript by default.

Default child context mode is `isolated`. The runtime may admit additional
context through:

- explicit task text
- selected agent profile
- admitted skills
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

## Implementation Slices

1. Add this doctrine to the roadmap and use it as the target for all related
   implementation.
2. Promote global identity from passive config to admitted prompt context.
3. Replace partial agent-definition shapes with one canonical agent profile
   contract.
4. Route `kiln run --agent` skills through `SkillRegistry` and context
   admission.
5. Extend `managed_agent.invoke` with requested `agentProfile`, `skills`, and
   `contextMode`.
6. Record admitted and denied profile/skill/context evidence in canonical
   session events.
7. Project the same agent and skill contracts into native harness configs based
   on harness capability declarations.

## Research Inputs

- Claude Code separates scoped memory, subagents, skills, hooks, plugins, MCP,
  and settings.
- Codex separates `AGENTS.md` project instructions from skills and caps prompt
  discovery.
- OpenCode separates agents, permissions, and skills, including per-agent skill
  permissions.
- Everything Claude Code and Gentle AI demonstrate market demand for portable
  skill and agent catalogs, but their content must be adapted into Kiln-native
  contracts rather than copied as product identity.
- Hermes and OpenClaw show mature patterns for skill guards, progressive
  disclosure, per-agent allowlists, child isolation, and resource handoff.
- Context-engineering research supports treating context as a governed runtime
  environment optimized for relevance, sufficiency, isolation, economy, and
  provenance.
