import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGatewayReplayDecision } from "../../src/model-gateway/replay-guard.js";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";
import { createCodexOAuthResponsesIngress } from "../../src/model-gateway/codex-oauth-responses-ingress.js";
import { startGateway } from "../../src/gateway/gateway-server.js";
import { CredentialWatcher } from "../../src/agents/credential-pool/credential-watcher.js";
import { WebhookDedup } from "../../src/gateway/webhook-dedup.js";

const secret = "synthetic-file-backed-replay-secret-32-bytes";
const fingerprint = { rawBody: "{}", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn", route: { providerId: "codex-oauth", providerModelId: "model", scope: "virtual:model" }, toolExecutionMode: "caller-owned" };
const completed = { responseId: "resp_synthetic", result: { parts: [{ type: "text" as const, text: "synthetic" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } };
const gatewayConfig = { port: 4901, accounts: [{ id: "account", providerId: "codex-oauth" as const, credentialId: "credential", maxConcurrency: 1, reservedAffinitySlots: 0 }], replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY" }, surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }, principals: [{ tokenEnv: "TOKEN", ingress: "openai-responses" as const, tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["model"] }], virtualModels: [{ id: "model", displayName: "Model", contextTokens: 1000, outputTokens: 100, providerId: "codex-oauth" as const, providerModelId: "model", accountIds: ["account"], capabilities: ["text" as const], affinity: { continuity: "none" as const } }] };

function store(path: string, ownerId: string): LocalModelGatewayStore {
  return new LocalModelGatewayStore({ path, replaySecret: secret, replayTtlMs: 5_000, replayMaxEntries: 20, accounts: [], ownerId, ownerStaleMs: 75 });
}

function requireDispatch(decision: ModelGatewayReplayDecision) {
  if (decision.kind !== "dispatch") throw new Error(`Expected dispatch, received ${decision.kind}.`);
  return decision;
}

async function child(mode: "claimed" | "committed", path: string): Promise<void> {
  const authority = store(path, `child-${mode}`);
  const claim = requireDispatch(authority.claim(authority.fingerprint(fingerprint)));
  if (mode === "committed") authority.markCommitted(claim.key, claim.fence);
  process.exit(0);
}

async function spawnCrash(mode: "claimed" | "committed", path: string): Promise<void> {
  const childProcess = Bun.spawn([process.execPath, import.meta.path, mode, path], { stdout: "inherit", stderr: "inherit" });
  const exitCode = await childProcess.exited;
  if (exitCode !== 0) throw new Error(`Crash fixture ${mode} exited ${exitCode}.`);
  await Bun.sleep(125);
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kiln-real-sqlite-"));
  try {
    const durablePath = join(root, "durable.sqlite");
    const first = store(durablePath, "owner-first");
    const key = first.fingerprint(fingerprint);
    const claim = requireDispatch(first.claim(key));
    first.markCommitted(key, claim.fence); first.complete(key, claim.fence, completed); first.close();
    if ((await stat(durablePath)).size === 0) throw new Error("SQLite database was not written to disk.");
    const reopened = store(durablePath, "owner-reopened");
    const replay = reopened.claim(key);
    if (replay.kind !== "replay-completed" || replay.value.responseId !== completed.responseId) throw new Error("Completed replay did not survive file-backed reopen.");
    let fenced = false;
    try { store(durablePath, "owner-conflict"); } catch (error) { fenced = error instanceof Error && error.message.includes("live runtime owner"); }
    if (!fenced) throw new Error("A second live SQLite owner was not fenced.");
    reopened.close(); reopened.close();

    const claimedPath = join(root, "claimed-crash.sqlite");
    await spawnCrash("claimed", claimedPath);
    const claimedRecovery = store(claimedPath, "claimed-recovery");
    requireDispatch(claimedRecovery.claim(claimedRecovery.fingerprint(fingerprint))); claimedRecovery.close();

    const committedPath = join(root, "committed-crash.sqlite");
    await spawnCrash("committed", committedPath);
    const committedRecovery = store(committedPath, "committed-recovery");
    if (committedRecovery.claim(committedRecovery.fingerprint(fingerprint)).kind !== "committed-unknown") throw new Error("Committed crash recovery permitted redispatch.");
    committedRecovery.close();

    const securePath = join(root, "secure-state", "gateway.sqlite");
    const handle = await createCodexOAuthResponsesIngress({
      config: gatewayConfig,
      databasePath: securePath,
      credentialRootDir: join(root, "auth"),
      env: { REPLAY: secret, TOKEN: "synthetic-bearer-token-at-least-32-bytes" },
    });
    handle.close();
    if (process.platform !== "win32") {
      if (((await stat(join(root, "secure-state"))).mode & 0o777) !== 0o700) throw new Error("State directory permissions are not 0700.");
      if (((await stat(securePath)).mode & 0o777) !== 0o600) throw new Error("SQLite database permissions are not 0600.");

      const existingDirectory = join(root, "existing-parent");
      await mkdir(existingDirectory); await chmod(existingDirectory, 0o755);
      const existingHandle = await createCodexOAuthResponsesIngress({ config: gatewayConfig, databasePath: join(existingDirectory, "gateway.sqlite"), credentialRootDir: join(root, "auth-existing"), env: { REPLAY: secret, TOKEN: "synthetic-bearer-token-at-least-32-bytes" } });
      existingHandle.close();
      if (((await stat(existingDirectory)).mode & 0o777) !== 0o755) throw new Error("Factory changed permissions on a pre-existing parent directory.");
    }

    const startupConfig = join(root, "late-startup.yaml");
    await writeFile(startupConfig, `port: 4800
apps: []
modelGateway:
  port: 4819
  accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }]
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
      - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [model] }
  virtualModels:
      - { id: model, displayName: Model, contextTokens: 1000, outputTokens: 100, providerId: codex-oauth, providerModelId: model, accountIds: [account], capabilities: [text], affinity: { continuity: none } }
`, "utf8");
    process.env.REPLAY_SECRET = secret; process.env.BEARER_TOKEN = "synthetic-bearer-token-at-least-32-bytes";
    let watcherStopped = false; let dedupClosed = false;
    const originalWatcherStop = CredentialWatcher.prototype.stop; const originalDedupClose = WebhookDedup.prototype.close;
    CredentialWatcher.prototype.stop = function () { watcherStopped = true; return originalWatcherStop.call(this); };
    WebhookDedup.prototype.close = function () { dedupClosed = true; return originalDedupClose.call(this); };
    let lateFailureObserved = false;
    try { await startGateway(startupConfig, { modelGatewayListener: () => { throw new Error("synthetic model bind failure"); } }); }
    catch (error) { lateFailureObserved = error instanceof Error && error.message.includes("synthetic model bind failure"); }
    finally { CredentialWatcher.prototype.stop = originalWatcherStop; WebhookDedup.prototype.close = originalDedupClose; }
    if (!lateFailureObserved || !watcherStopped || !dedupClosed) throw new Error("Late model-listener startup failure did not close all initialized resources.");
    console.log("real Bun SQLite durability, fencing, recovery, permissions, and startup cleanup checks passed");
  } finally { await rm(root, { recursive: true, force: true }); }
}

const mode = process.argv[2];
if (mode === "claimed" || mode === "committed") await child(mode, process.argv[3]!);
else await main();
