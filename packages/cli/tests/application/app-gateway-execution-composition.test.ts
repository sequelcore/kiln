import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineExecutionCatalog } from "@kilnai/core";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";
import { TranscriptStore } from "../../src/wrapper/session-store.js";
import { createAppGatewayExecutionComposition } from "../../src/application/app-gateway-execution-composition.js";

describe("createAppGatewayExecutionComposition", () => {
  it("uses the captured canonical snapshot and persists adoption events in the project transcript", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "kiln-app-gateway-"));
    const catalog = defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] });
    const configPath = await writeGatewayFixture(projectPath);
    const snapshot = {
      catalog,
      configurationRevision: {
        revisionSetId: "sha256:app-gateway-revision",
        revisions: { global: "sha256:global", project: "sha256:project" },
      },
    } as const;
    const composition = createAppGatewayExecutionComposition({
      projectPath,
      configPath,
      captureCatalogSnapshot: () => snapshot,
      readGlobalConfigSnapshot: () => ({ config: null, revision: "sha256:global" }),
    });

    expect(composition.bundle.snapshot.catalog).toBe(snapshot.catalog);
    expect(composition.bundle.accountRuntime).toBeDefined();
    expect(composition.bundle.evidenceStore).toBeDefined();
    expect(composition.bundle.snapshot.configurationRevision.revisions["app-gateway:gateway"]).toMatch(/^sha256:/u);
    expect(composition.bundle.snapshot.configurationRevision.revisionSetId).not.toBe(snapshot.configurationRevision.revisionSetId);

    const turnId = canonicalTurnId("session-1", 1);
    const authority = createOperatorAdoptionDecisionAuthority({
      ownerSessionId: "session-1",
      operatorTurnId: turnId,
      actorId: "user-1",
    });
    await composition.bundle.persistOperatorAdoptionDecision({
      eventId: "decision-1",
      kilnSessionId: "session-1",
      sequence: 1,
      timestamp: new Date("2026-08-22T00:00:00.000Z"),
      kind: "operator_adoption_decision",
      turnId,
      turnOrdinal: 1,
      ...authority,
      source: { actor: "runtime", surface: "runtime", component: "operator-adoption" },
    });

    const transcript = await new TranscriptStore(projectPath).readTranscript("session-1");
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({ kind: "operator_adoption_decision", turnId });
    expect(await readFile(join(projectPath, ".kiln", "runtime", "operator-session-account-capacity.sqlite"))).toBeDefined();
    composition.close();
  });

  it("supplies the configured canonical session-turn budget to Runtime admission", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "kiln-app-gateway-"));
    const configPath = await writeGatewayFixture(projectPath);
    const composition = createAppGatewayExecutionComposition({
      projectPath,
      configPath,
      captureCatalogSnapshot: () => ({
        catalog: defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] }),
        configurationRevision: { revisionSetId: "sha256:r1", revisions: { global: "sha256:g1" } },
      }),
      readGlobalConfigSnapshot: () => ({
        config: { sessionTurnBudget: { tokenLimit: 100, action: "stop" } },
        revision: "sha256:g1",
      }),
    });

    expect(composition.bundle.sessionTurnBudget).toBeDefined();
    composition.close();
  });

  it("fails closed when no canonical execution catalog can be captured", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "kiln-app-gateway-"));
    const configPath = await writeGatewayFixture(projectPath);
    expect(() => createAppGatewayExecutionComposition({
      projectPath,
      configPath,
      captureCatalogSnapshot: () => {
        throw new Error("Canonical execution catalog is unavailable.");
      },
      readGlobalConfigSnapshot: () => ({ config: null, revision: "sha256:global" }),
    })).toThrow("Canonical execution catalog is unavailable");
  });
});

async function writeGatewayFixture(projectPath: string): Promise<string> {
  const configPath = join(projectPath, "gateway.yaml");
  await writeFile(
    join(projectPath, "app.yaml"),
    await readFile(join(process.cwd(), "..", "runtime", "tests", "gateway", "fixtures", "apps", "mode-b-app.yaml"), "utf8"),
    "utf8",
  );
  await writeFile(configPath, "port: 4800\napps:\n  - name: app\n    config: ./app.yaml\n    channels:\n      - type: api\n        path: /app\n", "utf8");
  return configPath;
}
