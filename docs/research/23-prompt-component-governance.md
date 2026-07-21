# Prompt Component And Response Governance

Status: accepted research basis for minimal prompt assembly, response-profile
placement, and controlled-technical-English integration.

Implementation status: the first production slice covers Core manifest
contracts, exact Runtime assembly, fail-closed request matching, and redacted
provider-request evidence. Canonical session-event persistence and a dedicated
CLI/TUI/GUI inspection surface remain follow-up work. Universal prompt
reductions remain gated on representative model-specific evaluation.

## Question

Kiln needs to preserve authority and safety while avoiding universal prompt
text that constrains newer models, duplicates tool schemas, or applies one
writing style to every task. The design question is which behavior belongs in
native runtime contracts, instruction profiles, optional skills, or config.

## Sources

- Anthropic, "An update on recent Claude Code quality reports":
  <https://www.anthropic.com/engineering/april-23-postmortem>
- Agent Skills specification, progressive disclosure:
  <https://agentskills.io/specification>
- OpenAI prompt engineering and evaluation guidance:
  <https://developers.openai.com/api/docs/guides/prompt-engineering>
- ASD-STE100 Simplified Technical English, Issue 9:
  <https://www.asd-ste100.org/index.html>
- Local Codex checkout, bounded `AGENTS.md` discovery and skill metadata
  projection: `codex-rs/core/src/agents_md.rs` and
  `codex-rs/core-skills/src/render.rs`.
- Local OpenCode checkout, nested instruction loading and model-specific prompt
  selection: `packages/opencode/src/session/instruction.ts` and
  `packages/opencode/src/session/system.ts`.
- Local Claude Code research checkout, deferred tool schemas and cache-aware
  system prompt sections: `tools/ToolSearchTool/prompt.ts`,
  `constants/systemPromptSections.ts`, and `constants/prompts.ts`.

Local checked revisions used for review: Codex `0fb559f0f6`; OpenCode
`f5573281ca`. The Claude Code research directory did not contain Git metadata,
so its file evidence is useful but not revision-verifiable.

## Findings

Prompt minimalism is not a universal word-count rule. Anthropic reported that a
small hard verbosity instruction reduced coding performance, then adopted
per-model prompt evaluation and line-level ablation. OpenAI likewise recommends
testing prompt behavior when prompts or model versions change.

The checked harnesses converge on progressive disclosure:

- Codex caps repository instruction discovery and initially renders skill
  metadata rather than all skill bodies.
- OpenCode loads nested instructions only after work reaches the relevant path.
- Claude Code can defer full tool schemas until the model selects a tool.
- Codex and OpenCode keep model-specific prompt assets instead of assuming one
  prompt is optimal for every model family.

ASD-STE100 is a controlled natural language with writing rules and a controlled
dictionary. A prompt can guide drafting, but cannot prove compliance. Reliable
compliance needs the official operator-supplied standard, a deterministic
checker, and document-specific evaluation.

Action-first response shaping is useful as an accessibility preference, but
medical labels and absolute brevity rules are not neutral product doctrine.
Mandatory list caps, unsupported time estimates, or bans on necessary context
can reduce correctness.

## Decision

Kiln native runtime owns:

- typed prompt components and effective-prompt manifests;
- component provenance, revision, scope, model applicability, token accounting,
  prompt hash, and evaluation evidence;
- progressive instruction, skill, resource, and tool-schema disclosure;
- prompt budgets, cache boundaries, ablation fixtures, and regression gates;
- consistent selection and evidence across CLI, GUI, TUI, runtime, and managed
  children.

Instruction profiles contain only durable organization-wide doctrine. Task
procedures belong in skills. Provider/model selection and budgets belong in
config. Project facts and stack choices belong in project context or scoped
skills.

Kiln ships neutral `clear-writing` and `action-first-communication` skills.
Neither is universal doctrine. ASD-STE100 belongs in an optional compliance
pack with a validator; Kiln must distinguish guided drafting from validated
compliance.

## Promotion Gates

A prompt component or response skill becomes a default only when:

1. its owner, scope, provenance, and activation rule are explicit;
2. its token cost and cache placement are measured;
3. representative model-specific evals show non-regression;
4. removal ablations show that the component carries necessary behavior;
5. its rendered prompt and evidence are replayable;
6. it does not duplicate a tool schema, skill, project context, or higher-level
   authority contract.

## Non-Goals

- Do not make short output a proxy for intelligence or efficiency.
- Do not copy full community response prompts into global doctrine.
- Do not claim ASD-STE100 compliance from LLM prompting alone.
- Do not promote prompt-manifest evidence as operator-visible governance until
  canonical event persistence and a read-only inspection surface are wired.
