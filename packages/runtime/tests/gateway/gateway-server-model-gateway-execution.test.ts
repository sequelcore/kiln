import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startGateway } from "../../src/gateway/gateway-server.js";

describe("startGateway model-gateway execution composition", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("fails closed before starting resources when modelGateway has no execution bundle", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-gateway-model-execution-"));
    const configPath = join(root, "gateway.yaml");
    await writeFile(configPath, modelGatewayConfig(), "utf8");

    await expect(startGateway(configPath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: "Model gateway execution composition is required when modelGateway is configured.",
    });
  });
});

function modelGatewayConfig(): string {
  return `port: 4800
modelGateway:
  port: 4819
  replay:
    ttlMs: 60000
    maxEntries: 10
    hmacKeyEnv: REPLAY_SECRET
  surfaces:
    openAIResponses:
      maxBodyBytes: 1024
      maxConcurrentRequests: 1
  principals:
    - tokenEnv: BEARER_TOKEN
      ingress: openai-responses
      tenantId: tenant
      applicationId: app
      callerId: caller
      capabilityId: invoke
      scopes: [model.invoke]
      budgetEvidenceId: budget
      virtualModelIds: [codex]
  virtualModels:
    - id: codex
      displayName: Codex
      contextTokens: 1000
      outputTokens: 100
      executionRouteId: route
      capabilities: [text]
      affinity:
        continuity: none
`;
}
