import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createModelGatewayConfigDigest } from "@kilnai/runtime";
import { syncGlobalClaudeModelGatewayProjection } from "../../src/config/global-claude-model-gateway-projection.js";
import { syncGlobalControlPlaneMcpProjections } from "../../src/config/global-control-plane-mcp-projection.js";
import { readNativeProjectionInstallState } from "../../src/config/native-projection-state.js";

const workerRoot = process.env.KILN_PROJECTION_LOCK_PROBE_ROOT;
const workerKind = process.env.KILN_PROJECTION_LOCK_PROBE_KIND;
const gateway: ModelGatewayConfig = {
  port: 4910,
  replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
  surfaces: { anthropicMessages: { maxBodyBytes: 1_024, maxConcurrentRequests: 1 } },
  principals: [{ tokenEnv: "ANTHROPIC_AUTH_TOKEN", ingress: "anthropic-messages", nativeHarness: "claude", tenantId: "tenant", applicationId: "claude", callerId: "native", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["claude-kiln"] }],
  virtualModels: [{ id: "claude-kiln", displayName: "Claude via Kiln", contextTokens: 200_000, outputTokens: 8_192, targetId: "claude-route", capabilities: ["text"], affinity: { continuity: "none" } }],
};

if (workerRoot && workerKind === "mcp") {
  await syncGlobalControlPlaneMcpProjections({
    operation: "install",
    userHome: workerRoot,
    harnesses: ["claude"],
    launch: { executable: process.execPath, entrypoint: import.meta.path },
  });
  process.exit(0);
}
if (workerRoot && workerKind === "model") {
  await syncGlobalClaudeModelGatewayProjection({
    config: gateway,
    listener: { service: "kiln-model-gateway", status: "ready", protocolVersion: 1, instanceId: "probe", pid: process.pid, version: "probe", configDigest: createModelGatewayConfigDigest(gateway), port: gateway.port },
    targetPath: join(workerRoot, "project", ".claude", "settings.json"),
    installStateDir: join(workerRoot, ".kiln", "runtime", "native-projections"),
    operation: "install",
  });
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "kiln-global-projection-lock-"));
try {
  const workers = ["mcp", "model"].map((kind) => Bun.spawn([process.execPath, import.meta.path], {
    env: { ...process.env, KILN_PROJECTION_LOCK_PROBE_ROOT: root, KILN_PROJECTION_LOCK_PROBE_KIND: kind },
    stdout: "pipe",
    stderr: "pipe",
  }));
  const results = await Promise.all(workers.map(async (worker) => ({ code: await worker.exited, stderr: await new Response(worker.stderr).text() })));
  for (const result of results) if (result.code !== 0) throw new Error(`Projection lock worker failed: ${result.stderr}`);
  const targets = readNativeProjectionInstallState(join(root, ".kiln", "runtime", "native-projections")).targets;
  const targetIds = Object.keys(targets);
  if (!targets["global-control-plane-mcp:claude"] || !targetIds.some((id) => id.startsWith("global-claude-model-gateway:")) || targetIds.length !== 2) {
    throw new Error(`Concurrent MCP/model projection state was lost: ${targetIds.join(",")}`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
