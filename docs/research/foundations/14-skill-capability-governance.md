# Skill Capability Governance

Evidence cutoff: 2026-08-13.

This foundation preserves the evidence behind Kiln's skill capability plane.
Current behavior belongs in
[`agent-context.md`](../../architecture/context/agent-context.md) and the
[skills guide](../../guides/agents/skills.md).

## Durable findings

The portable [Agent Skills specification](https://agentskills.io/specification)
defines a skill as a directory package with a required `SKILL.md`, portable
identity metadata, and optional scripts, references, and assets. Harnesses add
different discovery, visibility, permission, and metadata mechanisms. Kiln
therefore separates portable package evidence from host-extension evidence and
does not treat a native projection as authority.

OpenAI Codex, Anthropic Agent Skills, and OpenCode all use progressive
disclosure: compact metadata supports discovery and full instructions load only
after selection. Current
[Codex documentation](https://learn.chatgpt.com/docs/build-skills) bounds the
initial list at two percent of model context, with an 8,000-character fallback
when context is unknown. Other harness budgets remain unknown unless a
versioned authority supplies them.

Availability is not admission or value. A package may be discoverable while
broken, incompatible, untrusted, unauthorized, or ineffective. Anthropic's
[enterprise guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise)
recommends reviewing the complete directory because scripts, network access,
credentials, broad filesystem references, and external tools carry risks that
are not visible from frontmatter alone. SLSA provenance establishes artifact
identity and production lineage when verified against expectations; it does
not prove semantic safety. Kiln accordingly reports provenance and risk
evidence without a misleading `safe` boolean.

Skill retrieval is a distinct empirical problem. SkillRet reports substantial
headroom in large-catalog retrieval; SkillRouter finds that bodies can carry
decisive retrieval signal beyond descriptions; and realistic skill-use
evaluation reports that gains can degrade toward no-skill baselines when the
agent must search a large noisy catalog. See:

- [SkillRet](https://arxiv.org/abs/2605.05726)
- [SkillRouter](https://arxiv.org/abs/2603.22455)
- [How Well Do Agentic Skills Work in the Wild](https://arxiv.org/abs/2604.04323)
- [SkillsBench](https://arxiv.org/abs/2602.12670)

These papers are primary research artifacts, not universal product guarantees.
Their joint implication is narrower: spec validity, install popularity, and
author reputation cannot establish value. Promotion needs paired, task-bound,
model- and harness-versioned evaluation that preserves negative task deltas,
routing mistakes, authority failures, context cost, latency, and replay
evidence.

## Accepted separations

- **identity and provenance** describe which complete package was observed;
- **health** describes structural validity, bounded size, references, and risk signals;
- **compatibility** describes declared and verified host requirements;
- **visibility** describes native discovery behavior;
- **admission** explains whether instructions entered governed context;
- **authority** remains owned by executable tool and work policy;
- **value** is a paired empirical result for a versioned task environment.

No one field substitutes for another. Skills never own provider routing,
permissions, stack versions, generated repository shims, or acceptance truth.

## Harness capability boundary

The current first-party documentation supports a capability matrix, not a
parity claim:

| Concern | Kiln managed | Codex | Claude Code | OpenCode |
| --- | --- | --- | --- | --- |
| Selection | governed recommendation and admission | native metadata and explicit invocation | native metadata and slash invocation | native `skill` tool |
| Child work | managed-job lifecycle when admitted | native delegation varies by session | native agents/tasks vary by session | native agents/tasks vary by session |
| Search/retrieval | admitted governed primitives | configured native/plugin/MCP capability | model, region, permission, and integration dependent | provider, tool, or MCP dependent |
| Visibility | canonical policy plus evidence | per-skill configuration | frontmatter invocation controls | stable 1.18.16 cannot preserve explicit-only direct invocation |
| Authority and terminal truth | executable Kiln contracts | native harness policy only | native harness policy only | native harness policy only |

Capability discovery at execution time is authoritative. A product name, tool
annotation, projected file, or prompt instruction is not proof that child
invocation, cancellation, browsing, citation artifacts, authority attenuation,
or terminal evidence is available. Unsupported translations remain visible and
fail closed.

Primary capability sources are the current
[Codex skills documentation](https://developers.openai.com/codex/skills),
[Codex configuration reference](https://developers.openai.com/codex/config-reference),
[Claude Code skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills),
[Claude Code permissions documentation](https://docs.anthropic.com/en/docs/claude-code/permissions),
[OpenCode skills documentation](https://opencode.ai/docs/skills/), and
[OpenCode permissions documentation](https://opencode.ai/docs/permissions/).

## Research-method consequence

Claim support is not citation presence. ALCE separates citation entailment and
completeness, while systematic- and rapid-review guidance shows that search
shortcuts can materially change conclusions. Kiln therefore requires an
explicit systematic, rapid, or decision-oriented mode; claim-dependent source
selection; independent evidence-lineage accounting; contradiction and adverse
evidence handling; citation existence, entailment, scope, placement, and
coverage checks; and an honest stopping rule. See
[ALCE](https://aclanthology.org/2023.emnlp-main.398/),
[PRISMA 2020](https://www.prisma-statement.org/prisma-2020), and
[Cochrane search guidance](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04).

Quantitative claims additionally require samples, metrics, baselines,
repetitions, uncertainty, exclusions, evaluator evidence, contamination risk,
and domain limits in proportion to the decision. General research procedure
does not replace specialist legal, medical, financial, regulatory, security,
scientific-method, or benchmark review.

## Operational consequence

Lifecycle operations inspect the complete source, validate health, compute an
immutable digest, refuse unreviewed overwrite, apply atomically, preserve
backups, verify the installed digest, and record ownership. Update and removal
refuse locally drifted content unless the operator explicitly forces the
reviewed operation.

Discovery and recommendation remain native capabilities over compact evidence,
not a reason to clone arbitrary skill repositories or preload large template
piles. Kiln admits the smallest complete package justified by the task and
keeps executable resources and declared tool dependencies visible for review.

The accepted orchestration procedure consumes executable work-governance
evidence, gives children bounded contracts, uses an acyclic work graph, forbids
parallel ownership of shared mutable surfaces, treats child output as an
untrusted proposal, and reports requested, admitted, executed, and adopted work
separately. The procedure cannot manufacture missing delegation capability or
widen route, provider, permission, budget, approval, or lifecycle authority.

Repository-context authoring follows the same boundary. Deterministic scouting
may propose or write canonical `.kiln/project-context.md`; generated
`AGENTS.md` and `CLAUDE.md` remain sync projections and are never the durable
authoring target.

## Non-claims

- A valid, signed, popular, or marketplace-listed skill is not necessarily safe, compatible, authorized, or useful.
- Skills do not always improve outcomes.
- One routing description does not transfer unchanged across models or harnesses.
- The cited benchmark results do not predict Kiln workflows without local paired evaluation.
- No universal cross-harness registry, version contract, or semantic security score was established.
