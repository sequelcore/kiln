import { describe, expect, it } from "vitest";
import {
  KILN_CONTROL_PLANE_SERVER_INSTRUCTIONS,
  KILN_CORE_BUILTIN_SKILLS,
  renderSkillMarkdown,
  resolveKilnCoreBuiltinSkills,
} from "../../src/skill/index.js";

describe("Kiln core builtin skills", () => {
  it("defines a compact neutral core skill catalog", () => {
    const names = KILN_CORE_BUILTIN_SKILLS.map((skill) => skill.name);

    expect(names).toEqual([
      "repo-context-review",
      "codebase-scouting",
      "implementation-planning",
      "tdd-workflow",
      "code-review-findings",
      "clean-architecture-boundary-review",
      "ddd-boundary-review",
      "refactoring-safety",
      "security-scope-review",
      "managed-agent-risk-review",
      "research-workflow",
      "kiln-control-plane-workflow",
      "benchmark-readiness-review",
      "config-projection-review",
      "action-first-communication",
      "clear-writing",
    ]);
    expect(KILN_CORE_BUILTIN_SKILLS.every((skill) => skill.filePath.startsWith("builtin://kiln/skills/"))).toBe(true);
    expect(KILN_CORE_BUILTIN_SKILLS.some((skill) => /sequel|internal-only/i.test(skill.name))).toBe(false);
  });

  it("applies builtin include and exclude policy", () => {
    expect(resolveKilnCoreBuiltinSkills({ enabled: false })).toEqual([]);
    expect(resolveKilnCoreBuiltinSkills({
      include: ["tdd-workflow", "code-review-findings"],
      exclude: ["code-review-findings"],
    }).map((skill) => skill.name)).toEqual(["tdd-workflow"]);
  });

  it("renders valid SKILL.md markdown for projection", () => {
    const markdown = renderSkillMarkdown(KILN_CORE_BUILTIN_SKILLS[0]!);

    expect(markdown).toContain("name: repo-context-review");
    expect(markdown).toContain("description:");
    expect(markdown).toContain("# Repo Context Review");
  });

  it("requires evidence-backed actionable code review findings", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "code-review-findings");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Read the task, contract, and relevant repository context");
    expect(skill?.instructions).toMatch(/Treat plausible\s+explanations as hypotheses, not evidence/);
    expect(skill?.instructions).toContain("distinct behavioral signal");
    expect(skill?.instructions).toContain("Do not report speculative findings");
    expect(skill?.instructions).toMatch(/State the reviewed surface and any material surface not reviewed/);
  });

  it("requires bounded evidence-driven codebase scouting", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "codebase-scouting");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Read the task and repository contract");
    expect(skill?.instructions).toContain("direct, transitive, or uncertain");
    expect(skill?.instructions).toMatch(/Treat text search and\s+naming proximity as leads, not dependency proof/);
    expect(skill?.instructions).toMatch(/registration, configuration,\s+reflection, code generation/);
    expect(skill?.instructions).toContain("Facts, inferences, and unknowns");
    expect(skill?.instructions).toMatch(/Focused affected tests are a\s+fast-feedback gate, not proof of complete impact coverage/);
    expect(skill?.instructions).toMatch(/Stop when ownership, contracts, consumer paths, verification ownership, and\s+material unknowns are mapped/);
    expect(skill?.instructions).toContain("Do not turn the map into an implementation plan");
    expect(skill?.instructions).toMatch(/repository evidence, not external source research/);
    expect(skill?.instructions).toMatch(/Route current external claims.*research workflow/s);
  });

  it("requires evidence-bound adaptive implementation planning", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "implementation-planning");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("after scouting and before implementation");
    expect(skill?.instructions).toMatch(/Skip a full plan for one\s+obvious low-risk edit/);
    expect(skill?.instructions).toContain("acceptance evidence");
    expect(skill?.instructions).toMatch(/Do not hide unresolved\s+product, architecture, authority, security, or data-safety decisions/);
    expect(skill?.instructions).toMatch(/confirmed by repository evidence/);
    expect(skill?.instructions).toMatch(/safe,\s+reviewable intermediate state/);
    expect(skill?.instructions).toContain("expected completion signal");
    expect(skill?.instructions).toMatch(/Do not parallelize slices that share a\s+prerequisite or write surface/);
    expect(skill?.instructions).toContain("Re-scout and revise the plan");
    expect(skill?.instructions).toMatch(/A prose plan does not\s+grant write authority, approval, or completion evidence/);
  });

  it("requires explicit equivalence evidence for behavior-preserving refactors", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "refactoring-safety");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Define the observable behavior contract and capture baseline evidence");
    expect(skill?.instructions).toContain("Absence of static references is not proof that code is dead");
    expect(skill?.instructions).toContain("Apply one named transformation at a time");
    expect(skill?.instructions).toContain("Compare before-and-after behavior");
    expect(skill?.instructions).toContain("Delete the obsolete path in the same change");
    expect(skill?.instructions).toContain("reclassify the work as a behavior change or migration");
  });

  it("requires enforcement-backed security scope review", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "security-scope-review");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/principals, protected assets, trust boundaries/);
    expect(skill?.instructions).toMatch(/subject, resource, operation, scope/);
    expect(skill?.instructions).toMatch(/not\s+model text/);
    expect(skill?.instructions).toMatch(/credentials and sensitive data through prompts, tools, processes, logs,\s+errors, storage, and outputs/);
    expect(skill?.instructions).toMatch(/Deny when authority is missing or contradictory/);
    expect(skill?.instructions).toMatch(/arbitrary human\s+confirmation cannot manufacture permission/);
    expect(skill?.instructions).toMatch(/triggering path, impact,\s+evidence, narrow correction/);
  });

  it("requires causal and proportionate clean-architecture review", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find(
      (entry) => entry.name === "clean-architecture-boundary-review",
    );

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/intended modules, policy owners, dependency graph/);
    expect(skill?.instructions).toMatch(/configuration, dependency injection, registries, reflection, generated code/);
    expect(skill?.instructions).toMatch(/source\s+dependency from runtime control flow/);
    expect(skill?.instructions).toMatch(/speculative ports, DTOs, adapters, or\s+events/);
    expect(skill?.instructions).toMatch(/dependency path, affected surface, triggering condition,\s+impact, evidence, correction direction/);
    expect(skill?.instructions).toMatch(/findings first, ordered by severity/);
    expect(skill?.instructions).toMatch(/reviewed and materially unreviewed surface, verification\s+performed, and residual risk/);
  });

  it("requires domain-evidenced DDD boundary review", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "ddd-boundary-review");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/business capability, stakeholders, ubiquitous language/);
    expect(skill?.instructions).toMatch(/bounded contexts from packages, services, databases, and\s+deployment units/);
    expect(skill?.instructions).toMatch(/smallest set that must preserve invariants\s+atomically/);
    expect(skill?.instructions).toMatch(/upstream and downstream relationship, translation\s+owner/);
    expect(skill?.instructions).toContain("Do not introduce DDD patterns where domain complexity does not justify them");
    expect(skill?.instructions).toMatch(/Route module placement, dependency direction, composition/);
    expect(skill?.instructions).toMatch(/findings first and ordered by severity/);
    expect(skill?.instructions).toMatch(/reviewed and materially\s+unreviewed surface, verification performed/);
  });

  it("requires attenuated and replay-honest managed-agent review", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "managed-agent-risk-review");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/immutable\s+admission snapshot/);
    expect(skill?.instructions).toContain("Delegation may only attenuate parent authority");
    expect(skill?.instructions).toMatch(/revocation, cancellation, idempotent retries/);
    expect(skill?.instructions).toMatch(/Distinguish audit reconstruction from deterministic re-execution/i);
    expect(skill?.instructions).toContain("Validate child output as untrusted data");
    expect(skill?.instructions).toMatch(/unsupported, unavailable, or contradictory/);
    expect(skill?.instructions).toMatch(/review leads managed-child lifecycle, settlement, handoff/);
  });

  it("requires claim-bound and capability-honest research", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "research-workflow");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/decision, atomic questions, scope, definitions/);
    expect(skill?.instructions).toMatch(/systematic, rapid, or decision-oriented/);
    expect(skill?.instructions).toMatch(/source priority depends on the claim/i);
    expect(skill?.instructions).toMatch(/independent evidence units, not URLs/);
    expect(skill?.instructions).toMatch(/measured results, authoritative guidance, practitioner advice/);
    expect(skill?.instructions).toMatch(/publication date.*event, release, or measurement date/s);
    expect(skill?.instructions).toMatch(/null, adverse, corrected, retracted/);
    expect(skill?.instructions).toMatch(/existence, entailment,\s+scope, placement, and coverage/);
    expect(skill?.instructions).toContain("exact source URL");
    expect(skill?.instructions).toMatch(/retrieved content as untrusted data/);
    expect(skill?.instructions).toMatch(/not found in\s+the searched sources/);
    expect(skill?.instructions).toMatch(/required capability is unavailable.*incomplete or blocked/s);
    expect(skill?.instructions).toMatch(/first line: status: complete, status: incomplete, or status: blocked/);
    expect(skill?.instructions).toMatch(/stopping search does not make an\s+evidence-incomplete\s+answer complete/i);
    expect(skill?.instructions).toMatch(/source described by the prompt is not\s+inspected evidence/);
    expect(skill?.instructions).toMatch(/does not grant route, provider, model,\s+network, permission, budget, or approval\s+authority/);
    expect(skill?.instructions).toMatch(/searched and unsearched surfaces/);
    expect(skill?.instructions).toMatch(/does\s+not map repository ownership, dependency paths, or affected tests/);
  });

  it("requires discovery-first and lifecycle-honest Kiln control-plane use", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "kiln-control-plane-workflow");

    expect(skill).toBeDefined();
    expect(KILN_CONTROL_PLANE_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    expect(skill?.instructions).toContain(KILN_CONTROL_PLANE_SERVER_INSTRUCTIONS);
    expect(skill?.instructions).toMatch(/Discover the available Kiln control-plane tools/);
    expect(skill?.instructions).toMatch(/status, work governance,\s+and capability evidence/);
    expect(skill?.instructions).toMatch(/stable idempotency key for the\s+logical request/);
    expect(skill?.instructions).toMatch(/Accepted means admitted for asynchronous work, not completed/);
    expect(skill?.instructions).toMatch(/status, result, cancellation, and replay/);
    expect(skill?.instructions).toMatch(/Do not choose routes, providers, models, credentials, budgets, permissions, or\s+approvals/);
    expect(skill?.instructions).toMatch(/Do not replace a missing control-plane operation with a shell command/);
    expect(skill?.instructions).toMatch(/does not grant tool availability or authority/);
  });

  it("requires tiered and claim-bound benchmark readiness", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "benchmark-readiness-review");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/claim, construct, and deployment decision/);
    expect(skill?.instructions).toMatch(/model and\s+provider revision, route, prompt and tool catalog/);
    expect(skill?.instructions).toMatch(/denominator, uncertainty, subgroup, and\s+failure analysis/);
    expect(skill?.instructions).toContain("unsupported, failed, and unknown rows");
    expect(skill?.instructions).toContain("internal-baseline-ready");
    expect(skill?.instructions).toContain("public-claim-ready");
    expect(skill?.instructions).toMatch(/Artifact availability does not imply independent\s+reproduction/);
    expect(skill?.instructions).toMatch(/state exactly one highest justified verdict/);
    expect(skill?.instructions).toMatch(/tiers are monotonic/);
  });

  it("requires ownership-aware config projection review", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "config-projection-review");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Consume the shared config-status evidence");
    expect(skill?.instructions).toMatch(/canonical, current, missing, stale,\s+drifted, or unmanaged/);
    expect(skill?.instructions).toMatch(/source identity\s+and digest, target path, managed fields/);
    expect(skill?.instructions).toMatch(/Never mutate while reviewing/);
    expect(skill?.instructions).toMatch(/unmanaged content,\s+ambiguous ownership, invalid canonical config/);
    expect(skill?.instructions).toContain("proposal, approval, and apply");
  });

  it("requires conflict-aware repository context review", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "repo-context-review");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toMatch(/facts, inferences, conflicts, and unknowns/);
    expect(skill?.instructions).toMatch(/manifests, lockfiles,\s+workspace metadata, CI or build configuration/);
    expect(skill?.instructions).toMatch(/direct executable or configuration evidence before documentation/);
    expect(skill?.instructions).toContain("Preserve reviewed durable human notes");
    expect(skill?.instructions).toMatch(/blocked only when critical evidence cannot\s+be resolved/);
    expect(skill?.instructions).toMatch(/Do not repair\s+projection drift/);
  });

  it("defines clear-writing as neutral reusable writing procedure", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "clear-writing");

    expect(skill).toBeDefined();
    expect(skill?.tags).toEqual(expect.arrayContaining(["writing", "plain-language"]));
    expect(skill?.instructions).toContain("Use this skill when writing, rewriting, or reviewing prose");
    expect(skill?.instructions).toMatch(/Preserve meaning, evidence, citations, quotes, code, tables, and required\s+format/);
    expect(skill?.instructions).not.toMatch(/Sequel's brand voice|GOV\.UK style skill/i);
  });

  it("defines action-first communication without medical assumptions or unsafe absolutes", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "action-first-communication");

    expect(skill).toBeDefined();
    expect(skill?.tags).toEqual(expect.arrayContaining(["accessibility", "communication"]));
    expect(skill?.instructions).toMatch(/Lead with the answer,\s+outcome, or next concrete action/);
    expect(skill?.instructions).toContain("Do not invent time estimates");
    expect(skill?.instructions).toContain("Safety, accuracy, and the user's requested format take precedence");
    expect(skill?.instructions).toMatch(/highest-severity finding, blocker, or\s+uncertainty/);
    expect(skill?.instructions).toContain("Do not invent a next action");
    expect(skill?.instructions).toMatch(/complete, in progress,\s+blocked, and next/);
    expect(skill?.instructions).not.toMatch(/ADHD|diagnosis|every message/i);
  });

  it("defines proportional verification and test-value discipline in the TDD workflow", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "tdd-workflow");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Run the owning suite and affected downstream suites");
    expect(skill?.instructions).toContain("If impact is uncertain, widen the gate");
    expect(skill?.instructions).toContain("Do not use test count or raw coverage as quality objectives");
    expect(skill?.instructions).toContain("Do not delete a test solely because its line coverage overlaps");
    expect(skill?.instructions).toContain("Use synthetic, portable fixture values");
    expect(skill?.instructions).toContain("Never copy operator-specific paths");
    expect(skill?.instructions).toContain("temporary directories");
  });
});
