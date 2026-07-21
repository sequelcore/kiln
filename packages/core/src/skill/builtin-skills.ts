import { stringify } from "yaml";
import type { SkillConfig } from "./types.js";

export interface BuiltinSkillPolicy {
  readonly enabled?: boolean;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

function defineBuiltinSkill(input: {
  readonly name: string;
  readonly description: string;
  readonly tools?: readonly string[];
  readonly tags?: readonly string[];
  readonly instructions: string;
}): SkillConfig {
  return {
    name: input.name,
    description: input.description,
    tools: input.tools ?? [],
    triggers: [],
    tags: input.tags ?? [],
    handler: undefined,
    filePath: `builtin://kiln/skills/${input.name}`,
    instructions: input.instructions.trim(),
  };
}

export const KILN_CORE_BUILTIN_SKILLS: readonly SkillConfig[] = [
  defineBuiltinSkill({
    name: "repo-context-review",
    description: "Review generated Kiln project context against real repository evidence before adoption or sync.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["kiln", "project-context", "repo-shims"],
    instructions: `
# Repo Context Review

Use this skill when a task asks for project context adoption, repo instruction
generation, or review of generated AGENTS.md / CLAUDE.md shims.

Workflow:
1. Inspect deterministic repository evidence before accepting generated context:
   - kiln project scout --json
   - package.json
   - canonical docs listed by the scout output
2. Compare .kiln/project-context.md against that evidence, including package metadata, scripts, workspace layout, and canonical docs.
3. Report only durable repo facts. Do not encode personal workflow preferences as project facts.
4. Recommend concrete changes to .kiln/project-context.md when evidence is missing or misleading.
5. Do not edit generated AGENTS.md or CLAUDE.md shims directly. They are projections from canonical Kiln config.

Review Criteria:
- Project name, package manager, scripts, workspaces, and canonical docs match the repository.
- Guidance points to canonical architecture/docs instead of duplicating them.
- No local absolute paths, secrets, machine-specific state, or legacy provider instructions are introduced.
- Any proposed addition is backed by a file path, script, or architecture doc.

Output:
- status: valid, needs_changes, or blocked.
- evidence: concise file/script references.
- recommendedChanges: concrete edits for .kiln/project-context.md.
- projectionImpact: whether kiln sync --repo-shims should be rerun.
`,
  }),
  defineBuiltinSkill({
    name: "codebase-scouting",
    description: "Map affected files, boundaries, dependencies, and risks before broad code changes.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["engineering", "scouting", "codebase"],
    instructions: `
# Codebase Scouting

Use this skill before changes that touch multiple files, unclear ownership, or
architecture-sensitive behavior.

Workflow:
1. Identify the owning bounded context, package, or surface.
2. Locate entry points, tests, adapters, DTOs, events, and projection helpers.
3. Separate stable contracts from implementation details.
4. Report impacted files, likely risks, and the minimum next implementation slice.
5. Do not propose unrelated refactors.

Output a concise map with evidence-backed file references and open risks.
`,
  }),
  defineBuiltinSkill({
    name: "implementation-planning",
    description: "Turn a scoped objective into an implementation sequence with files, verification, and rollback awareness.",
    tools: ["read", "grep", "glob"],
    tags: ["engineering", "planning"],
    instructions: `
# Implementation Planning

Use this skill after scouting and before implementation.

Workflow:
1. Restate the objective and non-goals.
2. Split work into atomic slices with clear file ownership.
3. Identify tests or verification gates for each slice.
4. Call out contract, data, config, and surface-parity implications.
5. Prefer the smallest plan that fully satisfies the requested behavior.

Do not include generic boilerplate. Every step must change or verify something
real.
`,
  }),
  defineBuiltinSkill({
    name: "tdd-workflow",
    description: "Design failing tests first, then implement and verify behavior without broadening scope.",
    tools: ["read", "grep", "glob", "bash", "write"],
    tags: ["engineering", "testing", "tdd"],
    instructions: `
# TDD Workflow

Use this skill for behavior changes and bug fixes where tests can express the
expected behavior.

Workflow:
1. Identify the owning test layer.
2. Write or specify the smallest failing test that proves the intended behavior.
3. Implement only enough production code to pass.
4. Refactor without changing behavior.
5. Run the focused test, then the relevant broader gate.

Fixture hygiene:
- Use synthetic, portable fixture values that express only the behavior under test.
- Never copy operator-specific paths, usernames, home directories, credentials,
  tokens, or raw incident payloads into tests.
- Use temporary directories for filesystem behavior. Use a generic OS-specific
  path only when that path syntax is itself part of the contract.
- Do not paste user-supplied bug text verbatim unless the exact literal is the
  contract. Reduce it to the smallest sanitized equivalent that still fails.

If a failing test is impractical, explain why and choose the closest executable
verification.
`,
  }),
  defineBuiltinSkill({
    name: "code-review-findings",
    description: "Review code findings-first with severity, evidence, and missing-test risk.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["engineering", "review"],
    instructions: `
# Code Review Findings

Use this skill for quality gates and completed-change review.

Review posture:
1. Lead with findings, ordered by severity.
2. Anchor each finding to concrete file and line evidence.
3. Prioritize correctness, regressions, boundary violations, security, and missing tests.
4. Avoid summaries until after findings.
5. If no issues are found, say that clearly and mention residual risk or test gaps.

Do not rewrite the author's intent unless the evidence shows a real problem.
`,
  }),
  defineBuiltinSkill({
    name: "clean-architecture-boundary-review",
    description: "Detect dependency-direction, layer, port, adapter, and surface-ownership violations.",
    tools: ["read", "grep", "glob"],
    tags: ["architecture", "clean-architecture", "review"],
    instructions: `
# Clean Architecture Boundary Review

Use this skill when evaluating architecture, module ownership, or cross-surface
changes.

Check:
1. Domain/core contracts do not import runtime, GUI, TUI, CLI, provider, or IO infrastructure.
2. Runtime owns execution policy and event emission; surfaces project evidence.
3. Cross-boundary behavior flows through explicit ports, DTOs, adapters, or events.
4. Shared behavior has one owner and one projection path.
5. Safety-sensitive behavior fails closed at the boundary.

Report boundary drift separately from style concerns.
`,
  }),
  defineBuiltinSkill({
    name: "ddd-boundary-review",
    description: "Review bounded contexts, aggregate boundaries, language leakage, and coupling risk.",
    tools: ["read", "grep", "glob"],
    tags: ["architecture", "ddd", "review"],
    instructions: `
# DDD Boundary Review

Use this skill when domain language, bounded contexts, or ownership boundaries
matter.

Check:
1. Concepts belong to the bounded context that owns their lifecycle.
2. Shared language is explicit and not leaked through convenience imports.
3. Aggregates and services do not absorb unrelated responsibilities.
4. Integration contracts are named and versioned where needed.
5. New abstractions remove real coupling or duplication.

Prefer concrete boundary evidence over abstract DDD terminology.
`,
  }),
  defineBuiltinSkill({
    name: "refactoring-safety",
    description: "Guide behavior-preserving cleanup with narrow diffs, executable checks, and no legacy residue.",
    tools: ["read", "grep", "glob", "bash", "write"],
    tags: ["engineering", "refactoring"],
    instructions: `
# Refactoring Safety

Use this skill for cleanup that should preserve behavior.

Workflow:
1. Identify the invariant behavior before editing.
2. Remove redundancy, dead code, and avoidable indirection only inside the scoped area.
3. Avoid compatibility branches unless an active documented contract requires them.
4. Keep commits atomic and diff-readable.
5. Run focused checks that prove behavior did not change.

If behavior must change, stop treating the work as a pure refactor.
`,
  }),
  defineBuiltinSkill({
    name: "security-scope-review",
    description: "Review authorization, secret handling, prompt/tool injection, and unsafe execution scope.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["security", "review", "safety"],
    instructions: `
# Security Scope Review

Use this skill for security-sensitive code, agent tools, config, credentials, or
external inputs.

Check:
1. Authority is explicit and cannot be inferred from model output.
2. Secrets are never logged, stored in repo files, or projected into prompts.
3. Untrusted content cannot change tool policy, route policy, or disclosure rules.
4. File, shell, network, and provider actions pass through the owning policy boundary.
5. Error messages reveal enough for operators without leaking sensitive data.

Treat prompt injection and tool injection as authorization problems, not prompt
style problems.
`,
  }),
  defineBuiltinSkill({
    name: "managed-agent-risk-review",
    description: "Audit child invocation authority, route identity, evidence, handoff, and replay guarantees.",
    tools: ["read", "grep", "glob"],
    tags: ["kiln", "managed-agents", "architecture", "review"],
    instructions: `
# Managed Agent Risk Review

Use this skill for managed child invocation design, implementation, or live-test
analysis.

Check:
1. Profile, provider, model, adapter, route, authority, context mode, and child identity are explicit.
2. The parent does not lend ambient authority to the child.
3. Requested agent profiles and skills are admitted before execution.
4. Terminal state, transcript, result handoff, and resource URIs are replayable.
5. Direct-provider and harness routes expose equivalent operator evidence or clearly state limitations.

Report missing evidence as a product risk, not a UI preference.
`,
  }),
  defineBuiltinSkill({
    name: "benchmark-readiness-review",
    description: "Evaluate whether benchmark or eval results are reproducible, comparable, and public-ready.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["eval", "benchmark", "readiness"],
    instructions: `
# Benchmark Readiness Review

Use this skill for benchmark, eval, or public performance claims.

Check:
1. Profile id/version, dataset version, scorer set, k, pass^k, config hash, provider/model, and commit are recorded.
2. Result artifacts, transcripts, tool calls, diagnostics, and managed invocation evidence are resolvable.
3. Benchmark adapters project normal Kiln runtime contracts and do not create private prompt/tool paths.
4. Limitations, unsupported rows, and failed cases are explicit.
5. Public claims separate model capability from Kiln governance capability.

Block readiness when reproducibility evidence is missing.
`,
  }),
  defineBuiltinSkill({
    name: "config-projection-review",
    description: "Review Kiln config, native projections, repo shims, drift state, and setup diagnostics.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["kiln", "config", "projection", "review"],
    instructions: `
# Config Projection Review

Use this skill when reviewing global config, project config, generated shims, or
native harness projection.

Check:
1. Canonical state lives under Kiln config, instructions, agents, and skills.
2. Native harness files and repo shims are generated projections, not durable doctrine.
3. Drift, unmanaged files, and stale projections are reported instead of silently overwritten.
4. Setup/status surfaces consume the shared config status contract.
5. Model-callable config changes use proposal, approval, and apply lifecycle.

Do not recommend direct edits to generated AGENTS.md, CLAUDE.md, or native
harness skill files.
`,
  }),
  defineBuiltinSkill({
    name: "action-first-communication",
    description: "Shape responses for fast scanning and execution by leading with the outcome or next action and keeping state visible.",
    tags: ["accessibility", "communication", "response-design", "productivity"],
    instructions: `
# Action-First Communication

Use this skill when the user or agent profile requests concise, highly
scannable, execution-oriented responses.

Rules:
1. Lead with the answer, outcome, or next concrete action. Do not begin with
   praise, a plan announcement, or background that can follow the result.
2. Number steps only when order matters. Keep each step to one bounded action.
3. Make state visible when work spans turns: state what is complete, what is in
   progress, and the next decision or action.
4. Keep tangents separate from the main task. Include them only when they
   materially change correctness, safety, or the next action.
5. State errors with cause, evidence, and the nearest corrective action. Avoid
   alarmist or performative language.
6. If work remains, end with one concrete next action when that helps the user
   proceed. Do not add generic closing pleasantries.

Do not invent time estimates. Do not force short answers when the user asks for
an explanation, comparison, walkthrough, or complete analysis.
Safety, accuracy, and the user's requested format take precedence over brevity.
`,
  }),
  defineBuiltinSkill({
    name: "clear-writing",
    description: "Write, rewrite, or review prose so it is clear, accurate, structured, and appropriate for the audience.",
    tags: ["writing", "plain-language", "editing", "communication"],
    instructions: `
# Clear Writing

Use this skill when writing, rewriting, or reviewing prose for any audience:
reports, research briefs, explanations, proposals, support replies, product
copy, UI text, public content, internal communication, educational material, or
technical documentation.

Do not use this skill to replace a required brand, legal, academic, regulatory,
or domain-specific style. Apply it inside those constraints.

Core principles:
1. Put the reader's task first: identify what they need to understand, decide,
   or do next.
2. State the main point early unless the requested format requires discovery or
   suspense.
3. Use concrete nouns, active verbs, and direct sentence structure.
4. Prefer short paragraphs and informative headings. Use bullets or tables only
   when they make comparison or scanning easier.
5. Remove filler, hype, vague intensifiers, performative certainty, and
   needless meta-commentary.
6. Preserve meaning, evidence, citations, quotes, code, tables, and required
   format. Do not simplify by making the content less true.
7. Define necessary terms near first use. Keep unavoidable specialist language
   when it carries precision.
8. Match tone to context: calm for operational work, careful for risk or
   uncertainty, warm for user-facing help, and concise for action requests.
9. Be explicit about uncertainty, source limits, assumptions, and next actions.
10. Keep accessibility in mind: avoid walls of text, ambiguous link text,
    unexplained acronyms, and structure that only works visually.

Editing workflow:
1. Identify the audience, purpose, constraints, and output format.
2. Preserve non-negotiable facts and required terminology.
3. Reorganize around the reader's path: context, point, evidence, action.
4. Replace abstract or inflated phrasing with precise language.
5. Cut repetition and generic AI-writing patterns without flattening the
   author's voice.
6. Verify that the revised version still supports the original claim and does
   not introduce unsupported facts.

Review output:
- If rewriting, provide the revised text.
- If reviewing, list the highest-impact issues first with examples and concrete
  edits.
- If constraints conflict, explain the tradeoff briefly and choose the clearest
  compliant version.

Reference basis:
- ISO 24495-1 plain language principles: reader need, findability,
  understandability, and usability.
- GOV.UK and other public-sector content design practice: plain words, active
  voice, useful headings, and reader-task orientation.
- Developer documentation style practice: preserve technical precision while
  reducing ambiguity and needless complexity.
`,
  }),
] as const;

export function resolveKilnCoreBuiltinSkills(
  policy: BuiltinSkillPolicy | undefined,
): readonly SkillConfig[] {
  if (policy?.enabled === false) {
    return [];
  }
  const include = normalizeNameSet(policy?.include);
  const exclude = normalizeNameSet(policy?.exclude) ?? new Set<string>();
  return KILN_CORE_BUILTIN_SKILLS.filter((skill) => {
    if (include && !include.has(skill.name)) {
      return false;
    }
    return !exclude.has(skill.name);
  });
}

export function renderSkillMarkdown(skill: SkillConfig): string {
  const frontmatter = {
    name: skill.name,
    description: skill.description,
    ...(skill.tools.length > 0 ? { tools: skill.tools } : {}),
    ...(skill.tags.length > 0 ? { tags: skill.tags } : {}),
  };
  return `---\n${stringify(frontmatter).trim()}\n---\n\n${skill.instructions.trim()}\n`;
}

function normalizeNameSet(values: readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (!values) {
    return undefined;
  }
  return new Set(values.map((value) => value.trim()).filter((value) => value.length > 0));
}
