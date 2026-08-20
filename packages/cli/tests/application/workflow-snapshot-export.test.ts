import { describe, expect, it } from "vitest";

import {
  WORK_GOVERNANCE_WORKFLOW_PROFILES,
} from "../../src/application/work-governance-workflows.js";
import {
  buildWorkflowSnapshotExport,
} from "../../src/application/workflow-snapshot-export.js";

describe("workflow-snapshot-export", () => {
  it("builds a deterministic manifest from canonical workflow evidence", () => {
    const first = buildWorkflowSnapshotExport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      generatedFiles: ["CLAUDE.md", "AGENTS.md"],
      projectContext: {
        projectName: "sample-project",
        packageManager: "bun",
        scripts: [["test", "bun test"], ["typecheck", "bun run typecheck"]],
        workspacePackages: ["packages/*"],
        docs: ["README.md", "docs/architecture/README.md"],
      },
      instructionProfiles: [{
        name: "sequel-engineering",
        scope: "global",
        filePath: "C:/Users/test/.kiln/instructions/sequel-engineering.md",
        instructions: "No dead code.",
        doctrine: {
          principles: ["No dead code."],
          workflow: ["Scout first."],
          qualityGates: ["Run tests."],
        },
      }],
      kilnConfig: {
        version: "1",
        provider: "codex-oauth",
        model: { default: "gpt-5.4-mini" },
        maxDepth: 3,
        parallelWorkers: 1,
        activeInstructionProfiles: ["sequel-engineering"],
        workGovernance: {
          defaultPosture: "orchestrate",
          requireDelegationFor: ["architecture", "ui"],
          requiredEvidence: ["surface-map", "tests", "typecheck", "residual-risk"],
        },
      },
    });
    const second = buildWorkflowSnapshotExport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      generatedFiles: ["AGENTS.md", "CLAUDE.md"],
      projectContext: {
        projectName: "sample-project",
        packageManager: "bun",
        scripts: [["test", "bun test"], ["typecheck", "bun run typecheck"]],
        workspacePackages: ["packages/*"],
        docs: ["README.md", "docs/architecture/README.md"],
      },
      instructionProfiles: [{
        name: "sequel-engineering",
        scope: "global",
        filePath: "C:/Users/test/.kiln/instructions/sequel-engineering.md",
        instructions: "No dead code.",
        doctrine: {
          principles: ["No dead code."],
          workflow: ["Scout first."],
          qualityGates: ["Run tests."],
        },
      }],
      kilnConfig: {
        version: "1",
        provider: "codex-oauth",
        model: { default: "gpt-5.4-mini" },
        maxDepth: 3,
        parallelWorkers: 1,
        activeInstructionProfiles: ["sequel-engineering"],
        workGovernance: {
          defaultPosture: "orchestrate",
          requireDelegationFor: ["architecture", "ui"],
          requiredEvidence: ["surface-map", "tests", "typecheck", "residual-risk"],
        },
      },
    });

    expect(first).toEqual(second);
    expect(first.manifest).toMatchObject({
      version: "1",
      generator: "workflow-snapshot-export-v1",
      generatedAt: "2026-05-12T00:00:00.000Z",
      sourceIds: [
        "project-context:sample-project",
        "instruction-profile:sequel-engineering",
        "work-governance:resolved-kiln-config",
        "model-policy:resolved-kiln-config",
        "workflow-profiles:static",
      ],
      generatedFiles: ["AGENTS.md", "CLAUDE.md"],
    });
    expect(first.manifest.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.specification).toMatchObject({
      projectName: "sample-project",
      packageManager: "bun",
      canonicalDocs: ["docs/architecture/README.md", "README.md"],
    });
    expect(first.plan).toMatchObject({
      defaultPosture: "orchestrate",
      evidenceBeforeDone: ["surface-map", "tests", "typecheck", "residual-risk"],
      orchestrationTriggers: ["architecture", "ui"],
    });
    expect(first.authorityPosture).toMatchObject({
      defaultPosture: "orchestrate",
    });
    expect(first.modelPolicyGuidance).toMatchObject({
      defaultProvider: "codex-oauth",
      defaultModel: "gpt-5.4-mini",
      maxDepth: 3,
      parallelWorkers: 1,
    });
    expect(first.workItems.map((profile) => profile.id)).toEqual(
      WORK_GOVERNANCE_WORKFLOW_PROFILES.map((profile) => profile.id),
    );
  });

  it("changes the manifest hash when canonical workflow evidence changes", () => {
    const base = buildWorkflowSnapshotExport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      generatedFiles: ["AGENTS.md"],
      projectContext: {
        projectName: "sample-project",
        packageManager: "bun",
        scripts: [],
        workspacePackages: [],
        docs: ["README.md"],
      },
      instructionProfiles: [],
      kilnConfig: {
        version: "1",
        workGovernance: {
          defaultPosture: "orchestrate",
          requiredEvidence: ["tests"],
        },
      },
    });
    const changed = buildWorkflowSnapshotExport({
      generatedAt: "2026-05-12T00:00:00.000Z",
      generatedFiles: ["AGENTS.md"],
      projectContext: {
        projectName: "sample-project",
        packageManager: "bun",
        scripts: [],
        workspacePackages: [],
        docs: ["README.md"],
      },
      instructionProfiles: [],
      kilnConfig: {
        version: "1",
        workGovernance: {
          defaultPosture: "orchestrate",
          requiredEvidence: ["tests", "typecheck"],
        },
      },
    });

    expect(changed.manifest.hash).not.toBe(base.manifest.hash);
  });
});
