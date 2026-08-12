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
    description: "Map ownership, dependency paths, affected verification, and uncertainty before multi-file or architecture-sensitive changes.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["engineering", "scouting", "codebase"],
    instructions: `
# Codebase Scouting

Use this skill before changes that touch multiple files, unclear ownership, or
architecture-sensitive behavior, or when asked to identify affected code or
tests. Scouting establishes a defensible change boundary; it does not design the
implementation.

Workflow:
1. Read the task and repository contract. Start from the named behavior, changed
   files, symbols, failing tests, or observable entry point instead of surveying
   the whole repository. When scouting a diff, record the exact comparison base
   and include uncommitted changes.
2. Identify the owning bounded context, package, and surface. Separate stable
   contracts from implementation details and note dirty-worktree overlap.
3. Trace evidence in both directions:
   - inward to dependencies, schemas, configuration, and authorities the behavior
     relies on;
   - outward to callers, adapters, DTOs, events, projections, build targets,
     tests, and user-facing consumers.
   Classify each relationship as direct, transitive, or uncertain.
4. Prefer repository-native dependency graphs, build metadata, compiler or
   language-server references, and executable traces. Treat text search and
   naming proximity as leads, not dependency proof. Record the graph or tool and
   the assumptions behind its affected set.
5. Check edges static analysis commonly misses: registration, configuration,
   reflection, code generation, dependency injection, plugins, scripts,
   serialization, database contracts, environment variables, and external APIs.
6. Map verification ownership. Name the smallest focused tests that exercise the
   direct behavior, then the downstream contract, integration, package, or
   workspace gates justified by the impact map. Focused affected tests are a
   fast-feedback gate, not proof of complete impact coverage. Widen verification
   for shared contracts, build or dependency changes, dynamic edges, or uncertain
   reachability.
7. Stop when ownership, contracts, consumer paths, verification ownership, and
   material unknowns are mapped well enough for a bounded planning decision.
   Record searched and unsearched surfaces; do not inventory the repository for
   its own sake.

Evidence discipline:
- Facts, inferences, and unknowns must be distinguishable.
- Every impacted file or target needs a causal path from the task or change seed.
- Absence of a text reference is not evidence that a runtime consumer does not
  exist.
- Do not propose unrelated refactors. Do not turn the map into an implementation plan.

Output:
- scope seed and owning boundary;
- stable contracts and implementation details;
- direct, transitive, and uncertain consumers with evidence-backed file or target
  references;
- verification map, hidden-edge checks, and material unsearched surface;
- smallest defensible change boundary and open risks for planning or specialist
  review.
`,
  }),
  defineBuiltinSkill({
    name: "implementation-planning",
    description: "Produce repository-evidenced implementation sequences for scoped, nontrivial changes with decisions, dependencies, verification, and recovery.",
    tools: ["read", "grep", "glob"],
    tags: ["engineering", "planning"],
    instructions: `
# Implementation Planning

Use this skill after scouting and before implementation when work crosses files,
contracts, boundaries, or surfaces, or carries meaningful uncertainty or risk.
Skip a full plan for one obvious low-risk edit; state the change and focused
verification instead.

Workflow:
1. State the intended outcome, acceptance evidence, and non-goals. Preserve the
   user's actual contract rather than expanding it into adjacent cleanup.
2. List material assumptions, unknowns, and decisions. Do not hide unresolved
   product, architecture, authority, security, or data-safety decisions inside an
   implementation step. Stop for operator or specialist direction when a choice
   materially changes behavior, risk, or scope.
3. Ground the affected surface in the scout map and current repository state.
   Treat files and symbols as exact only when confirmed by repository evidence;
   label other surfaces as candidates to verify during execution.
4. Split work by coherent behavior or invariant. Each slice must leave a safe,
   reviewable intermediate state and name:
   - its outcome and why it is necessary;
   - confirmed files, symbols, contracts, and owning surface;
   - prerequisites and dependents;
   - focused verification and its expected completion signal;
   - rollback, roll-forward, or recovery when state or deployment can escape the
     repository.
5. Order prerequisites before consumers. Do not parallelize slices that share a
   prerequisite or write surface. Mark slices independent only when their state,
   ownership, and verification do not conflict.
6. Include contract, data, config, generated-artifact, documentation, cleanup,
   and surface-parity work only when evidenced consumers require it. Schedule
   failing behavior proof before production edits when TDD is practical, without
   designing or writing the test in the plan.
7. End with proportionate completion gates and residual risk. Name focused,
   downstream, integration, or broader gates justified by the dependency surface;
   do not use a ritual full-suite step as generic boilerplate.
8. Re-scout and revise the plan when execution, tests, or repository changes
   invalidate a premise, reveal a new dependency, or broaden the surface. Remove
   or supersede stale steps instead of executing them ceremonially.

Output:
- objective, acceptance evidence, and non-goals;
- confirmed evidence, assumptions, open decisions, and candidate surfaces;
- numbered slices with outcome, owned surface, dependencies, verification signal,
  and recovery;
- final gates and residual risks.

Prefer the smallest plan that fully satisfies the requested behavior. Every step
must change or verify something real. Do not invent paths, line numbers, time
estimates, approvals, or rollback guarantees. Do not implement, adjudicate a
specialist decision, or mark work complete while planning. A prose plan does not
grant write authority, approval, or completion evidence; use the repository's
structured plan, work-item, or approval system when one exists.
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
5. Run the focused test during red-green iteration.
6. Run the owning suite and affected downstream suites before completion when
   behavior, contracts, or shared dependencies change.
7. Run the complete suite when repository evidence, risk, integration, release,
   or scheduled CI requires it. If impact is uncertain, widen the gate and state
   what remains uncertain.

Test value:
- Retain a test when it protects distinct public behavior, a regression, a
  boundary or invariant, or a materially different failure mode.
- Prefer strengthening an existing test when it already provides the required
  regression signal. Do not use test count or raw coverage as quality objectives.
- Repair or delete tests that are obsolete, redundant, flaky,
  implementation-coupled, or behavior-free.
- Do not delete a test solely because its line coverage overlaps another test.
  Use behavioral and fault-detection evidence when distinct value is uncertain.

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
    description: "Review completed code changes findings-first with severity, evidence, actionable defect risk, and verification gaps.",
    tools: ["read", "grep", "glob", "bash"],
    tags: ["engineering", "review"],
    instructions: `
# Code Review Findings

Use this skill for quality gates and completed-change review.

Workflow:
1. Read the task, contract, and relevant repository context before judging the
   diff. Inspect targeted surrounding code, dependencies, and tests; avoid
   indiscriminate context loading.
2. Map the changed surface and likely blast radius. Review every human-authored
   line in scope or state the exceptions.
3. Check correctness, regressions, security and authority, boundary direction,
   failure handling, concurrency and data integrity, maintainability, and
   verification gaps. Name specialist review that remains necessary.
4. Review tests as production code: confirm that they are correct, reliable,
   behavior-focused, and contribute a distinct behavioral signal. A missing test
   is a finding only when a material behavior is unprotected and a specific test
   would close the gap.
5. Validate each candidate finding against repository evidence. Treat plausible
   explanations as hypotheses, not evidence; use a focused test, trace, or
   executable counterexample when practical.

Finding admission:
- Report only an issue introduced or exposed by the change with a concrete
  condition and material impact.
- Anchor the finding to the narrowest file and line evidence, and explain the
  causal path from input or state to observable failure.
- Rank severity by impact, reach, and recoverability, not by rhetorical
  confidence. If verification is incomplete, say so.
- Do not report speculative findings, stylistic preferences, or mechanically
  enforced concerns as defects.
- Do not demand duplicate tests, raw coverage increases, or implementation-detail
  assertions when existing tests already protect the behavior.

Output:
1. Lead with findings ordered by severity; omit summaries before findings.
2. For each finding, give location, triggering condition, impact, evidence, and
   the narrowest correction direction without rewriting the author's solution.
3. State the reviewed surface and any material surface not reviewed, verification
   performed, and residual risk.
4. If no issues are found, say so clearly. Do not invent a finding to avoid an
   empty result.

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
    description:
      "Guide behavior-preserving refactors with explicit invariants, dependency evidence, incremental transformations, and proportional verification.",
    tools: ["read", "grep", "glob", "bash", "write"],
    tags: ["engineering", "refactoring"],
    instructions: `
# Refactoring Safety

Use this skill when changing internal structure while preserving observable behavior.

Workflow:
1. Define the observable behavior contract and capture baseline evidence before editing. Include public APIs, outputs, persisted or serialized data, errors, ordering, side effects, authority decisions, and concurrency or performance properties when they are part of the contract.
2. Map the affected dependency surface and every known consumer. Check configuration, reflection, registration, generated code, scripts, operational entrypoints, and runtime evidence where applicable. Absence of static references is not proof that code is dead.
3. State the intended structural improvement and the residual concern by name. Do not introduce an abstraction unless it removes demonstrated coupling, duplication, or responsibility confusion.
4. Apply one named transformation at a time. Prefer compiler-, type-system-, or AST-assisted changes for moves and renames, and keep each intermediate state buildable and behaviorally valid.
5. After each transformation, run the narrowest checks that can expose semantic drift. Then verify affected dependents in proportion to reach and risk; do not substitute habitual full-suite execution for dependency reasoning.
6. Compare before-and-after behavior directly when existing tests are weak or the contract crosses a boundary. Use deterministic characterization, differential, integration, or trace evidence appropriate to the risk.
7. Review the diff for accidental changes to defaults, constants, errors, ordering, transactions, async behavior, authorization, data shape, and resource use. Tests should assert observable behavior rather than the prior implementation shape.
8. Delete the obsolete path in the same change. Do not retain wrappers, aliases, flags, or compatibility branches without an identified active consumer or explicit data-migration requirement; confirm no residual references remain.
9. Record the verified surface, checks run, and residual uncertainty. If behavior changes or equivalence cannot be established, reclassify the work as a behavior change or migration and use its testing and rollout discipline.
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
