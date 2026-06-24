# Cross-Harness Governance Plan

Date: 2026-06-24
Status: Completed on 2026-06-24

## Objective

Resolve the first memo problem: repo-level work governance can require
delegation, review, or authority that the active harness cannot actually
provide. Kiln must make the correct behavior native, cross-surface, and
cross-harness.

## Problem

Projected instructions are not runtime authority. Claude Code, Codex, OpenCode,
Kiln GUI, Kiln TUI, and direct-provider routes expose different subagent,
approval, tool, memory, and config capabilities. When repo policy requires a
capability that is unavailable in the current harness, agents can stall,
narrate the conflict, invent review evidence, or write transient project memory
files.

## Decision

Kiln treats missing harness capability as governed evidence. The parent must
use an admitted managed invocation route, continue locally only when the
configured evidence gates remain satisfiable, or pause with a typed
missing-capability requirement. Native harness subagents, hooks, slash commands,
permission modes, and config files are adapter/projection mechanisms, not
canonical work-governance authority.

This is a global/resolved-config behavior, not a one-off repo note. The core
work-item contract is shared across Kiln surfaces, and repo shims project the
rule from resolved global plus project config whenever work governance is
enabled.

## Canonical Documentation

- `docs/architecture/work-governance.md` owns the normative cross-harness
  degradation rule.
- `docs/research/13-work-governance-and-verification.md` owns the external
  research basis.
- `docs/architecture/harness-integration-capabilities.md` owns specific harness
  projection mechanisms and capability proof.

## Implementation Slices

1. Documentation baseline
   - Add cross-harness authority degradation to work governance.
   - Refresh research basis with official OpenAI, MCP, NIST, Claude Code, and
     OpenCode evidence.
   - Update the private memo with the solved design status.

2. Contract follow-up
   - Audit whether `work_governance.assess`, work items, and managed invocation
     pause requirements can represent `missing-harness-capability` explicitly.
   - Add or tighten tests only if the current contract cannot express it.

   Status: completed on 2026-06-24. Work item pause requirements now support a
   typed `capability` kind for missing harness/tool/route capability blocks.

3. Projection follow-up
   - Ensure generated repo shims tell standalone harnesses to degrade through
     available local verification or typed pause evidence instead of creating
     scratch memory workarounds.

   Status: completed on 2026-06-24. Repo-shim generation now projects the
   cross-harness authority rule into generated `AGENTS.md` and `CLAUDE.md`
   files, and this repository's shims were regenerated from the local source
   entrypoint.

## Verification Criteria

- Public docs contain no private X source list, handles, tweet ids, or secrets.
- `git diff --check` passes.
- If code changes become necessary, run focused package tests and
  `bun run typecheck` before closeout.

## Verification

- Passed: `bun run --cwd packages/core test tests/work-governance/goal-execution.test.ts`
- Passed: `bun run --cwd packages/cli test src/application/work-governance-tool.test.ts`
- Passed: `bun run --cwd packages/cli test tests/application/repo-shim-projection.test.ts`
- Passed: `bun packages/cli/src/index.ts sync --repo-shims --project C:\Proyectos\Sequel\kiln`
- Passed: `bun run typecheck`
- Passed: `git diff --check`
