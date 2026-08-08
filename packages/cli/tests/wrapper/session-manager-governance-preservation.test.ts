import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateTextTokens, InMemoryContextArtifactCache } from "@kilnai/core";
import type { ContextCandidate } from "@kilnai/core";
import { SessionManager } from "../../src/wrapper/session-manager.js";
import type { WrapperConfig } from "../../src/wrapper/index.js";
import type { KilnAppConfig } from "../../src/config.js";
import { buildOperatorIdentityContextCandidate } from "../../src/config/operator-identity-context.js";
import { buildWorkGovernanceContextCandidate } from "../../src/application/work-governance-context.js";
import { resolveInstructionProfileContextCandidates } from "../../src/application/instruction-profile-context.js";
import { renderSessionLedger } from "../../src/application/session-ledger.js";
import { buildPreamble, resolveTurnPrompt } from "../../src/wrapper/preamble-builder.js";

/**
 * Issue #57 regression: governance-bearing context (operator identity, work
 * governance, and the active instruction profile) must never be deferred by
 * DefaultContextGovernor under budget pressure. All three producers mark
 * their candidates `required: true`; this test proves that contract holds
 * end to end through the real SessionManager.prepare() -> real
 * DefaultContextGovernor path, not through mocks or literal fixtures.
 */
describe("SessionManager governance context preservation under budget pressure", () => {
  const WRAPPER_CONFIG: WrapperConfig = {
    mode: "api-key",
    permissionPolicy: { approval: "on-request", sandbox: "read-only" },
  };

  let userHome: string;
  let projectPath: string;
  const PROFILE_NAME = "regression-governance-profile";
  const REQUIRED_INSTRUCTION_TAIL = "KILN_TEST_REQUIRED_INSTRUCTION_LINE_250";
  const REQUIRED_INSTRUCTION_BODY = Array.from(
    { length: 250 },
    (_, index) => `KILN_TEST_REQUIRED_INSTRUCTION_LINE_${index + 1}`,
  ).join("\n");

  beforeEach(() => {
    userHome = mkdtempSync(join(tmpdir(), "kiln-gov-userhome-"));
    projectPath = mkdtempSync(join(tmpdir(), "kiln-gov-project-"));
    const instructionsDir = join(userHome, ".kiln", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    writeFileSync(
      join(instructionsDir, `${PROFILE_NAME}.md`),
      [
        "---",
        `name: ${PROFILE_NAME}`,
        "displayName: Regression Governance Profile",
        "description: Synthetic fixture for issue #57 regression coverage.",
        "---",
        REQUIRED_INSTRUCTION_BODY,
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(userHome, { recursive: true, force: true });
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("preserves governor-admitted context in the complete preamble while omitting governor-deferred context", async () => {
    const identityCandidate = buildOperatorIdentityContextCandidate({
      name: "Regression Operator",
      timezone: "UTC",
    });
    const workGovernanceCandidate = buildWorkGovernanceContextCandidate({
      defaultPosture: "orchestrate",
      directExecution: { maxFiles: 1, maxRisk: "low" },
    });
    const instructionProfileCandidates = resolveInstructionProfileContextCandidates({
      projectPath,
      userHome,
      globalConfig: { version: "1", activeInstructionProfiles: [PROFILE_NAME] },
    });

    expect(identityCandidate).toBeDefined();
    expect(workGovernanceCandidate).toBeDefined();
    expect(instructionProfileCandidates).toHaveLength(1);
    expect(identityCandidate?.required).toBe(true);
    expect(workGovernanceCandidate?.required).toBe(true);
    expect(instructionProfileCandidates[0]?.required).toBe(true);

    // Mirror the ledger block SessionManager.prepare() always injects (required,
    // score 1) so the budget calculation below accounts for all required tokens,
    // not just the three governance producers under test.
    const ledgerContent = renderSessionLedger({ currentPhase: "prepare", workingDirectory: projectPath });
    const ledgerTokens = ledgerContent ? estimateTextTokens(ledgerContent) : 0;

    const requiredTokens = [identityCandidate, workGovernanceCandidate, ...instructionProfileCandidates]
      .reduce((total, candidate) => total + estimateTextTokens((candidate as ContextCandidate).content), ledgerTokens);

    const smallOptionalContent = "KILN_TEST_ADMITTED_OPTIONAL_CONTEXT";
    const smallOptionalTokens = estimateTextTokens(smallOptionalContent);
    const largeOptionalContent = "KILN_TEST_DEFERRED_CONTEXT ".repeat(400);
    const largeOptionalTokens = estimateTextTokens(largeOptionalContent);

    // The budget admits every required block plus the small optional candidate
    // exactly, leaving zero headroom for the larger one. This is
    // real budget pressure (total candidate tokens exceed the budget), not a
    // budget that happens to fit everything.
    const turnBudget = requiredTokens + smallOptionalTokens;
    expect(requiredTokens + smallOptionalTokens + largeOptionalTokens).toBeGreaterThan(turnBudget);

    const smallOptionalCandidate: ContextCandidate = {
      kind: "knowledge",
      source: "synthetic:small-optional",
      content: smallOptionalContent,
      required: false,
      score: 0.1,
    };
    const largeOptionalCandidate: ContextCandidate = {
      kind: "knowledge",
      source: "synthetic:large-optional",
      content: largeOptionalContent,
      required: false,
      score: 0.9,
    };
    const appConfig: KilnAppConfig = {
      createRegistry: () => ({
        loadInstalledDomains: () => undefined,
        detectAndMerge: () => ({
          name: "regression",
          displayName: "Regression Test Domain",
          detectPatterns: [],
          toolTags: new Set(),
          qualityGates: [],
          multishotExamples: "",
          phaseExamples: "",
        }),
      }) as never,
      buildSystemPrompt: () => "system prompt",
      contextCandidates: [
        identityCandidate as ContextCandidate,
        workGovernanceCandidate as ContextCandidate,
        ...instructionProfileCandidates,
        smallOptionalCandidate,
        largeOptionalCandidate,
      ],
      kilnYaml: {
        contextGovernance: {
          turnBudget,
        },
      } as never,
    };

    const manager = new SessionManager(
      WRAPPER_CONFIG,
      appConfig,
      new InMemoryContextArtifactCache(),
    );

    const sessionContext = await manager.prepare("issue #57 regression coverage", projectPath);
    const { projectedContext } = sessionContext;
    const audit = projectedContext.auditTrail?.[0];
    expect(audit).toBeDefined();
    if (!audit) return;

    expect(audit.governor).toBe("DefaultContextGovernor");
    expect(audit.tokenBudget).toBe(turnBudget);
    expect(audit.requiredTokens).toBeLessThanOrEqual(turnBudget);
    expect(audit.deferredBlockIds.length).toBeGreaterThan(0);

    const identityBlock = projectedContext.blocks.find(
      (block) => block.source === "operator-identity:~/.kiln/config.yaml#identity",
    );
    const workGovernanceBlock = projectedContext.blocks.find(
      (block) => block.source === "work-governance:resolved-kiln-config#workGovernance",
    );
    const instructionProfileBlock = projectedContext.blocks.find(
      (block) => block.source === instructionProfileCandidates[0]?.source,
    );

    expect(identityBlock).toBeDefined();
    expect(workGovernanceBlock).toBeDefined();
    expect(instructionProfileBlock).toBeDefined();
    if (!identityBlock || !workGovernanceBlock || !instructionProfileBlock) return;

    const governanceBlockIds = [identityBlock, workGovernanceBlock, instructionProfileBlock]
      .map((block) => block.id);
    expect(governanceBlockIds).toHaveLength(3);

    for (const blockId of governanceBlockIds) {
      expect(audit.requiredBlockIds).toContain(blockId);
      expect(audit.preservedRequiredBlockIds).toContain(blockId);
      expect(audit.deferredBlockIds).not.toContain(blockId);
    }
    expect(audit.preservedRequiredBlockIds).toContain(instructionProfileBlock.id);

    expect(
      projectedContext.blocks.some((block) => block.source === "synthetic:large-optional"),
    ).toBe(false);
    const deferredLargeOptionalBlockId = projectedContext.deferredBlocks?.find(
      (block) => block.source === "synthetic:large-optional",
    )?.id;
    expect(deferredLargeOptionalBlockId).toBeDefined();
    if (deferredLargeOptionalBlockId) {
      expect(audit.deferredBlockIds).toContain(deferredLargeOptionalBlockId);
    }

    const preamble = buildPreamble(sessionContext, WRAPPER_CONFIG.permissionPolicy);
    const admittedSyntheticBlocks = projectedContext.blocks.filter((block) =>
      block.source.startsWith("synthetic:"),
    );
    expect(admittedSyntheticBlocks.map((block) => block.source)).toEqual([
      "synthetic:small-optional",
    ]);
    const resolvedTurn = resolveTurnPrompt({
      prompt: preamble,
      promptKind: "kiln-preamble",
      task: sessionContext.task,
      fallbackSystemPrompt: sessionContext.systemPrompt,
    });
    for (const block of admittedSyntheticBlocks) {
      expect(audit.selectedBlockIds).toContain(block.id);
      expect(resolvedTurn.systemPrompt).toContain(block.content);
    }
    expect(resolvedTurn.systemPrompt).toContain(REQUIRED_INSTRUCTION_TAIL);
    expect(resolvedTurn.systemPrompt).not.toContain("KILN_TEST_DEFERRED_CONTEXT");
    expect(resolvedTurn.systemPrompt).not.toContain("[context evidence truncated");
    expect(resolvedTurn.userPrompt).toBe(sessionContext.task);
  });
});
