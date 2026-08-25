# Prompt Component And Response Governance

Status: accepted research basis for minimal prompt assembly, response-profile
placement, progressive disclosure, and controlled-technical-English
integration.

Evidence cutoff: 2026-08-25.

Owner: [Roadmap 06 - Prompt Governance Plane](../../roadmap/06-prompt-governance-plane.md)

Promotion target: canonical prompt-governance architecture and operator-facing
inspection guidance.

Exit condition: promote stable inspection, progressive-disclosure, and
evaluation contracts, preserve reusable evaluation evidence, and delete this
research note.

Implementation status: the first production slices cover Core manifest
contracts, exact Runtime assembly, fail-closed request matching, redacted
provider-request evidence, canonical prompt observation, and communication
governance. Progressive disclosure and prompt-component evaluation remain
follow-up work. No universal prompt reduction is earned without representative
model-and-harness-specific evaluation.

## Decision Question

Which behavior should Kiln place in native runtime contracts, durable
instruction profiles, optional skills, scoped project context, or executable
configuration, and what evidence is sufficient to promote a prompt component
to a default?

The research tested five narrower questions:

1. Are prompt effects stable across models, snapshots, and harnesses?
2. Does adding more context reliably help, or does selection matter?
3. Is progressive disclosure an established harness pattern, and where can it
   fail?
4. Which prompt evidence can be observed without retaining sensitive content?
5. Can prompt text serve as an authority or security enforcement boundary?

## Method And Limits

This was decision-oriented research, not a systematic literature review. It
prioritized primary production reports, official model and observability
guidance, peer-reviewed or preprint experiments, and revision-pinned source
from cloned agent harnesses. Practitioner and community material was admitted
only as workflow or fixture-discovery evidence, never as proof of causal
effectiveness.

The stopping rule was met when every material design conclusion had at least
two independent primary sources or one direct production incident plus
implementation evidence, and an explicit search for adverse or limiting
evidence had been recorded. No public controlled study was found that validates
Kiln's exact manifest, SHA-256 identity, content-free event, and activation
contract as one end-to-end architecture. Those details remain Kiln design and
must earn promotion through its own evaluation and privacy gates.

## Evidence By Claim

### Prompt changes are model-and-harness specific

Anthropic's April 2026 Claude Code incident is the strongest directly relevant
production evidence. A hard verbosity instruction caused a 3% regression on a
broader coding evaluation and was reverted. Anthropic's corrective controls
included broad per-model evaluation, line-level ablations, review tooling,
model-specific gates, and gradual rollout. This directly supports Slice 2; it
does not establish that shorter or longer prompts are generally superior.

OpenAI's prompt-engineering guidance independently says that outputs are
nondeterministic, model families and snapshots can require different
prompting, and prompt/model changes should be protected by evals. Anthropic's
agent-evaluation guidance further treats the evaluated system as the model plus
its harness, recommends multiple trials, and prioritizes task outcomes over
transcript appearance.

Academic results reinforce the risk while limiting its scope:

- Sclar et al. found large accuracy variation from semantically irrelevant
  prompt-format changes and weak transfer of good formats between models.
- PromptSET and ProSA found sensitivity varies by task, model, wording, and
  prompting regime rather than following a universal rule.
- Zheng et al. found prompt components contribute unequally to adversarial
  robustness, supporting component-aware tests rather than only whole-prompt
  comparisons.

Most of these academic experiments use classification, QA, instruction-tuning,
or older/open models. They establish that prompt sensitivity is real; they do
not predict the effect size for a current frontier coding agent or prove that
Kiln's component manifest improves it.

Decision consequence: evaluate the exact model, provider route, snapshot, and
harness revision. Compare baseline, candidate, and removal ablation over
multiple trials. Score correctness, safety, and task outcome before style,
length, tokens, or transcript aesthetics.

### Context selection matters; minimal does not mean short

Anthropic's context-engineering guidance describes a finite attention budget
and recommends the smallest high-signal context that remains sufficient for
the task. It explicitly warns against both bloated edge-case lists and
under-specified prompts. Long-context studies such as Lost in the Middle and
RULER show that nominal context capacity is not equivalent to reliable use of
all included information.

The detailed evidence and boundary conditions live in
[Context Governance](../foundations/context-governance.md). That evidence
supports bounded selection, not a universal instruction to prune. Required
authority, safety, task, and recovery information must remain available before
the action it governs.

Decision consequence: token reduction is an optimization only after required
behavior is preserved. Cache or token gains cannot offset correctness, safety,
or tool-trajectory regressions.

### Progressive disclosure is convergent architecture, not outcome proof

Four inspected harnesses independently implement scoped or deferred loading:

- Codex bounds repository-instruction discovery and initially projects skill
  metadata rather than every skill body.
- OpenCode loads nested instructions after work reaches a relevant path and
  loads complete skills only through the skill tool.
- Gemini CLI initially exposes skill name and description, then returns the
  full body and resources through explicit `activate_skill` use.
- A local Claude Code research checkout defers many tool schemas until tool
  selection and distinguishes cache-stable from cache-breaking system-prompt
  sections.

The first three observations are revision-verifiable. The Claude checkout had
no Git metadata, so it is corroborating implementation evidence only.

This convergence shows that progressive disclosure is a real production
architecture pattern. It does not prove that every deferred component improves
quality. Current skill research summarized in
[Skill Capability Governance](../foundations/skill-capability-governance.md)
shows that large-catalog retrieval remains difficult and that metadata-only
discovery can miss useful skills when descriptions omit decisive routing
signals.

Decision consequence: separate admission from activation. Initial projection
may be metadata-only, but retrieval quality, false negatives, activation cost,
and removal behavior need evals. Safety and authority content cannot be
deferred behind the consequential action.

### Component identity is useful evidence, not externally proven architecture

Production incidents and prompt-sensitivity studies support isolating prompt
changes and running component-level ablations. They do not prescribe Kiln's
exact component schema, ordering rules, SHA-256 prompt identity, or event
shape.

Decision consequence: retain the typed manifest because it makes exact request
attribution, replay, ablation, and deletion mechanically testable. Treat those
properties as Kiln-owned invariants verified by code and fixtures, not as a
claim that a paper or lab endorsed this particular design.

### Observability should be content-free by default

OpenTelemetry's generative-AI conventions treat system instructions, messages,
tool arguments, and tool results as potentially sensitive content. Its current
guidance makes content capture opt-in while allowing operational metadata such
as model identity and token counts. The conventions are still evolving and do
not specify Kiln's hash contract.

Decision consequence: canonical prompt observations contain identities,
counts, scopes, route/config references, and token estimates, not raw prompts,
tool payloads, secrets, or caller-controlled provenance text. Any future
content capture requires a separate explicit privacy and retention decision.

### Prompt text is not an enforcement boundary

OpenAI's instruction-hierarchy work shows that lower-trust text can conflict
with privileged instructions and that model training can improve, but not
eliminate, this class of failure. Anthropic's prompt-injection research likewise
reports residual attack success and layers model behavior with classifiers.

Decision consequence: prompt provenance and hierarchy are diagnostic evidence.
Permissions, validation, admission, secret handling, sandboxing, and
consequential-effect policy remain executable boundaries outside the prompt.

### Practitioner and community evidence has a narrow role

Promptfoo demonstrates a maintained open-source workflow for comparing prompts
and models and running prompt regression checks in CI. Hamel Husain's
practitioner guidance recommends testing system-versus-user placement against
the exact provider, model, and use case. These sources can inform fixtures,
failure taxonomies, and operator workflow; popularity and anecdotal success do
not satisfy a promotion gate.

## Evidence-Backed Decisions

Kiln native runtime owns:

- typed prompt components and the effective-prompt manifest;
- exact final-request attribution and content-free observation;
- component provenance, revision, scope, model applicability, token estimate,
  prompt identity, and evaluation identity;
- progressive instruction, skill, resource, and tool-schema activation;
- prompt budgets, cache boundaries, ablation fixtures, and regression gates;
- consistent selection and evidence across CLI, GUI, TUI, Runtime, replay, and
  managed children.

Instruction profiles contain only durable organization-wide doctrine. Task
procedures belong in skills. Project facts belong in adopted project context.
Provider/model selection, native controls, permissions, and budgets belong in
executable configuration.

Kiln ships neutral `clear-writing` and `action-first-communication` skills;
neither is universal doctrine. ASD-STE100 is a controlled natural language,
not a prompt pattern. It belongs in an optional compliance pack only with an
authoritative operator-supplied standard, a deterministic validator, explicit
distribution authority, and honest separation of guided drafting, validation,
and human certification.

## Kiln-Specific Design Still Requiring Evaluation

- Whether the current component granularity is the best ablation unit.
- Whether SHA-256 identity plus config and harness revision is sufficient for
  reproducible replay across every provider path.
- Which metadata produces acceptable skill/instruction activation recall.
- Which components can be deferred without delaying required safety or
  recovery information.
- Whether a communication default helps any admitted model-and-route pair
  without harming exact-format, long-form, or required-content behavior.
- The statistical and operational thresholds for promotion, rollback, and
  route-specific veto.

## Promotion Gates

A prompt component, removal, or response skill becomes a default only when:

1. its owner, scope, provenance, activation rule, and removal path are explicit;
2. the exact model, provider route, snapshot, harness revision, config identity,
   and manifest identity are captured;
3. baseline, candidate, and removal-ablation inputs are replayable;
4. multiple trials use outcome-first correctness and safety graders, with style,
   length, tokens, and cache behavior evaluated second;
5. aggregate improvement cannot hide a material model- or route-specific
   regression;
6. token cost, cache placement, retrieval recall, and activation failures are
   measured where relevant;
7. observation remains content-free unless a separately approved privacy and
   retention contract allows content;
8. the component does not duplicate a tool schema, skill, project context,
   config decision, or higher-authority contract;
9. the evidence records source class, limitations, contradictions, and a
   predeclared no-promotion outcome.

## Sources

### Labs And Official Guidance

- Anthropic, [April 23 Claude Code quality postmortem](https://www.anthropic.com/engineering/april-23-postmortem).
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
- Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
- Anthropic, [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents).
- Anthropic, [Prompt injection defenses](https://www.anthropic.com/research/prompt-injection-defenses).
- OpenAI, [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering).
- OpenAI, [The Instruction Hierarchy](https://openai.com/index/the-instruction-hierarchy/).
- Agent Skills, [Specification](https://agentskills.io/specification).
- ASD-STE100, [Simplified Technical English Issue 9](https://www.asd-ste100.org/index.html).

### Academic Primary Sources

- Sclar et al., [Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design](https://arxiv.org/abs/2310.11324), ICLR 2024.
- Razavi et al., [Benchmarking Prompt Sensitivity in Large Language Models](https://arxiv.org/abs/2502.06065), PromptSET.
- Zhuo et al., [ProSA: Assessing and Understanding the Prompt Sensitivity of LLMs](https://arxiv.org/abs/2410.12405).
- Zheng et al., [Are All Prompt Components Value-Neutral?](https://aclanthology.org/2026.eacl-long.374/), EACL 2026.
- Liu et al., [Lost in the Middle](https://arxiv.org/abs/2307.03172), TACL 2024.
- Hsieh et al., [RULER](https://openreview.net/forum?id=kIoBbc76Sy), COLM 2024.

### Observability And Practitioner Signals

- OpenTelemetry, [Generative AI semantic attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/).
- OpenTelemetry, [GenAI observability and content-capture defaults](https://opentelemetry.io/blog/2026/genai-observability/).
- Promptfoo, [open-source prompt evaluation and red teaming](https://github.com/promptfoo/promptfoo).
- Hamel Husain, [What should go in the system prompt vs. the user prompt?](https://hamel.dev/blog/posts/evals-faq/what-should-go-in-the-system-prompt-vs-the-user-prompt.html).

### Revision-Pinned Harness Source

- Codex `32329b289d05eb6a3f8e35c267ceb25ba46716a2`:
  [`agents_md.rs`](https://github.com/openai/codex/blob/32329b289d05eb6a3f8e35c267ceb25ba46716a2/codex-rs/core/src/agents_md.rs) and
  [`render.rs`](https://github.com/openai/codex/blob/32329b289d05eb6a3f8e35c267ceb25ba46716a2/codex-rs/core-skills/src/render.rs).
- OpenCode `3016830e253492ef41b6cc00dbed623e5989279b`:
  [`instruction.ts`](https://github.com/anomalyco/opencode/blob/3016830e253492ef41b6cc00dbed623e5989279b/packages/opencode/src/session/instruction.ts),
  [`system.ts`](https://github.com/anomalyco/opencode/blob/3016830e253492ef41b6cc00dbed623e5989279b/packages/opencode/src/session/system.ts), and
  [`skill.ts`](https://github.com/anomalyco/opencode/blob/3016830e253492ef41b6cc00dbed623e5989279b/packages/opencode/src/tool/skill.ts).
- Gemini CLI `3818efbbfbf8ef029ef53a6ab1093db39971ce83`:
  [`snippets.ts`](https://github.com/google-gemini/gemini-cli/blob/3818efbbfbf8ef029ef53a6ab1093db39971ce83/packages/core/src/prompts/snippets.ts) and
  [`activate-skill.ts`](https://github.com/google-gemini/gemini-cli/blob/3818efbbfbf8ef029ef53a6ab1093db39971ce83/packages/core/src/tools/activate-skill.ts).
- Local Claude Code research checkout: `tools/ToolSearchTool/prompt.ts` and
  `constants/systemPromptSections.ts`; no Git metadata was present, so this is
  not revision-verifiable promotion evidence.

## Non-Goals

- Do not make short output a proxy for intelligence or efficiency.
- Do not copy full community response prompts into global doctrine.
- Do not infer causal quality from lab authority, repository popularity, or
  cross-harness convergence.
- Do not claim ASD-STE100 compliance from LLM prompting alone.
- Do not treat prompt text, manifests, or hashes as security enforcement.
