import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGatewayReplayDecision } from "../../src/model-gateway/replay-guard.js";
import { defineExecutionCatalog, type ModelGatewayConfig } from "@kilnai/core";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";
import {
  createModelGatewayExecutionRoutingPort,
  createModelGatewayIngress,
  type ModelGatewayExecutionCandidatePort,
} from "../../src/model-gateway/model-gateway-ingress.js";
import { startGateway } from "../../src/gateway/gateway-server.js";
import { CredentialWatcher } from "../../src/agents/credential-pool/credential-watcher.js";
import { WebhookDedup } from "../../src/gateway/webhook-dedup.js";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { Database } from "bun:sqlite";

const secret = "synthetic-file-backed-replay-secret-32-bytes";
const fingerprint = { rawBody: "{}", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn", route: { providerId: "codex-oauth", providerModelId: "model", scope: "virtual:model" }, toolExecutionMode: "caller-owned" };
const completed = { responseId: "resp_synthetic", result: { parts: [{ type: "text" as const, text: "synthetic" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } };
const evidence = { sourceIdentity: "fixture", sourceRevision: "v1", sourceDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-08-11T00:00:00.000Z", validUntil: "2027-08-11T00:00:00.000Z", confidence: "high" as const, authority: "configured" as const };
const executionCatalog = defineExecutionCatalog({
  accounts: [{ id: "account", providerId: "codex-oauth", credentialId: "credential", maxConcurrency: 1, reservedAffinitySlots: 0, economics: { capacityIdentity: "account-capacity", subscriptionClass: "subscription", quotaClassId: "quota", creditPosture: "disabled", overagePosture: "disabled" } }],
  accountPolicies: [],
  routes: [{ id: "route", label: "Model", providerId: "codex-oauth", providerModelId: "model", dataClassification: "internal", dataPolicyEvidence: { providerId: "codex-oauth", providerModelId: "model", dataUse: "not-used", trainingPosture: "prohibited", retention: { posture: "zero", days: 0 }, permittedMaximumClassification: "internal", permittedClassifications: ["public", "internal"], sourceIdentity: "fixture-privacy", sourceRevision: "rev-1", sourceDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-08-11T00:00:00.000Z", expiresAt: "2027-08-11T00:00:00.000Z" }, accountSelection: { mode: "exact", accountId: "account" }, economics: { adapterCapabilityId: "fixture", adapterCapabilityVersion: "v1", authBillingChannel: "oauth-subscription", executionMode: "responses-api", serviceTier: "standard", rateCardBasis: "configured", envelopeSemantics: "configured-upper-bound", fallbackPosture: "disabled", overagePosture: "disabled", contextClass: "standard", cacheClass: "provider-cache", priceEvidence: { kind: "subscription", rateCardId: "fixture", rateCardRevision: "v1", evidence }, auxiliaryCharges: [], executionEnvelope: { limits: [] } } }],
});
const gatewayConfig: ModelGatewayConfig = { port: 4901, replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY" }, surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }, principals: [{ tokenEnv: "TOKEN", ingress: "openai-responses", tenantId: "tenant", applicationId: "app", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["model"] }], virtualModels: [{ id: "model", displayName: "Model", contextTokens: 1000, outputTokens: 100, executionRouteId: "route", capabilities: ["text"], affinity: { continuity: "none" } }] };
const noCandidates: ModelGatewayExecutionCandidatePort = { resolve: async () => [] };

function store(path: string): LocalModelGatewayStore {
  return new LocalModelGatewayStore({ path, replaySecret: secret, replayTtlMs: 5_000, replayMaxEntries: 20 });
}

function requireDispatch(decision: ModelGatewayReplayDecision) {
  if (decision.kind !== "dispatch") throw new Error(`Expected dispatch, received ${decision.kind}.`);
  return decision;
}

async function child(mode: "claimed" | "committed", path: string): Promise<void> {
  const authority = store(path);
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
  const accountCapacityAuthority = new SqliteManagedAccountLeaseAuthority({ path: ":memory:", participantKind: "model-gateway-ingress", recoveryDomain: `bun-store-${crypto.randomUUID()}`, configurationRevision: "fixture" });
  const modelGatewayExecution = { executionCatalog, executionRouting: createModelGatewayExecutionRoutingPort(executionCatalog), executionCandidates: noCandidates, executionDispatcher: { resolve: async () => { throw new Error("No dispatcher is available in this fixture."); } }, accountCapacityAuthority };
  try {
    const durablePath = join(root, "durable.sqlite");
    const first = store(durablePath);
    const key = first.fingerprint(fingerprint);
    const claim = requireDispatch(first.claim(key));
    first.markCommitted(key, claim.fence); first.complete(key, claim.fence, completed); first.close();
    if ((await stat(durablePath)).size === 0) throw new Error("SQLite database was not written to disk.");
    const reopened = store(durablePath);
    const replay = reopened.claim(key);
    if (replay.kind !== "replay-completed" || replay.value.responseId !== completed.responseId) throw new Error("Completed replay did not survive file-backed reopen.");
    reopened.close(); reopened.close();

    const capacityPath = join(root, "ingress-capacity.sqlite");
    const capacityStore = store(capacityPath);
    await capacityStore.ingressCapacityEvidence.record({
      occurredAt: "2026-08-13T00:00:00.000Z", correlationId: "request-1", requestClass: "responses",
      outcome: "queue-timeout", origin: "ingress", phase: "pre-dispatch", retryable: true,
      retryAfterSeconds: 1, waitMs: 1000,
    });
    capacityStore.close();
    const capacityDb = new Database(capacityPath, { readonly: true, strict: true });
    const capacityPayload = capacityDb.query<{ payload: string }, []>("SELECT payload FROM ingress_capacity_evidence").get();
    capacityDb.close();
    if (!capacityPayload || JSON.parse(capacityPayload.payload).outcome !== "queue-timeout") throw new Error("Ingress capacity evidence was not durable.");

    const claimedPath = join(root, "claimed-crash.sqlite");
    await spawnCrash("claimed", claimedPath);
    const claimedRecovery = store(claimedPath);
    requireDispatch(claimedRecovery.claim(claimedRecovery.fingerprint(fingerprint))); claimedRecovery.close();

    const committedPath = join(root, "committed-crash.sqlite");
    await spawnCrash("committed", committedPath);
    const committedRecovery = store(committedPath);
    if (committedRecovery.claim(committedRecovery.fingerprint(fingerprint)).kind !== "committed-unknown") throw new Error("Committed crash recovery permitted redispatch.");
    committedRecovery.close();

    const securePath = join(root, "secure-state", "gateway.sqlite");
    const handle = await createModelGatewayIngress({
      config: gatewayConfig,
      ...modelGatewayExecution,
      databasePath: securePath,
      env: { REPLAY: secret, TOKEN: "synthetic-bearer-token-at-least-32-bytes" },
    });
    handle.close();
    if (process.platform !== "win32") {
      if (((await stat(join(root, "secure-state"))).mode & 0o777) !== 0o700) throw new Error("State directory permissions are not 0700.");
      if (((await stat(securePath)).mode & 0o777) !== 0o600) throw new Error("SQLite database permissions are not 0600.");

      const existingDirectory = join(root, "existing-parent");
      await mkdir(existingDirectory); await chmod(existingDirectory, 0o755);
      const existingHandle = await createModelGatewayIngress({ config: gatewayConfig, ...modelGatewayExecution, databasePath: join(existingDirectory, "gateway.sqlite"), env: { REPLAY: secret, TOKEN: "synthetic-bearer-token-at-least-32-bytes" } });
      existingHandle.close();
      if (((await stat(existingDirectory)).mode & 0o777) !== 0o755) throw new Error("Factory changed permissions on a pre-existing parent directory.");
    }

    const startupConfig = join(root, "late-startup.yaml");
    await writeFile(startupConfig, `port: 4800
apps: []
modelGateway:
  port: 4819
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_SECRET }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
      - { tokenEnv: BEARER_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [model] }
  virtualModels:
      - { id: model, displayName: Model, contextTokens: 1000, outputTokens: 100, executionRouteId: route, capabilities: [text], affinity: { continuity: none } }
`, "utf8");
    process.env.REPLAY_SECRET = secret; process.env.BEARER_TOKEN = "synthetic-bearer-token-at-least-32-bytes";
    const missingGuiDist = join(root, "missing-gui-dist");
    let watcherStartCalls = 0; let modelListenerCallsBeforeGuiValidation = 0; let intervalCreationCalls = 0; let watcherStopsBeforeGuiValidation = 0; let dedupClosesBeforeGuiValidation = 0;
    const originalWatcherStart = CredentialWatcher.prototype.start; const originalWatcherStopBeforeGuiValidation = CredentialWatcher.prototype.stop; const originalDedupCloseBeforeGuiValidation = WebhookDedup.prototype.close;
    const originalSetInterval = globalThis.setInterval;
    CredentialWatcher.prototype.start = async function () { watcherStartCalls += 1; };
    CredentialWatcher.prototype.stop = function () { watcherStopsBeforeGuiValidation += 1; return originalWatcherStopBeforeGuiValidation.call(this); };
    WebhookDedup.prototype.close = function () { dedupClosesBeforeGuiValidation += 1; return originalDedupCloseBeforeGuiValidation.call(this); };
    globalThis.setInterval = (() => { intervalCreationCalls += 1; return 0 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval;
    let guiValidationError: unknown;
    try {
      await startGateway(startupConfig, { guiDistPath: missingGuiDist, modelGatewayExecution, modelGatewayListener: () => { modelListenerCallsBeforeGuiValidation += 1; throw new Error("Model listener must not run before GUI validation."); } });
    } catch (error) {
      guiValidationError = error;
    } finally {
      CredentialWatcher.prototype.start = originalWatcherStart;
      CredentialWatcher.prototype.stop = originalWatcherStopBeforeGuiValidation;
      WebhookDedup.prototype.close = originalDedupCloseBeforeGuiValidation;
      globalThis.setInterval = originalSetInterval;
    }
    const expectedGuiValidationError = `GUI bundle missing at ${join(missingGuiDist, "index.html")}. Install @kilnai/gui or provide a built GUI dist path.`;
    if (!(guiValidationError instanceof Error) || guiValidationError.message !== expectedGuiValidationError) throw new Error(`Expected missing GUI bundle error "${expectedGuiValidationError}", observed "${guiValidationError instanceof Error ? guiValidationError.message : String(guiValidationError)}".`);
    if (watcherStartCalls !== 0) throw new Error(`CredentialWatcher started ${watcherStartCalls} time(s) before GUI validation; observed error "${guiValidationError.message}".`);
    if (modelListenerCallsBeforeGuiValidation !== 0) throw new Error(`Model Gateway listener ran ${modelListenerCallsBeforeGuiValidation} time(s) before GUI validation; observed error "${guiValidationError.message}".`);
    if (intervalCreationCalls !== 0) throw new Error(`Startup created ${intervalCreationCalls} timer(s) before GUI validation; observed error "${guiValidationError.message}".`);
    if (watcherStopsBeforeGuiValidation !== 0 || dedupClosesBeforeGuiValidation !== 0) throw new Error(`Missing GUI validation required rollback (watcher stops: ${watcherStopsBeforeGuiValidation}, deduplicator closes: ${dedupClosesBeforeGuiValidation}); observed error "${guiValidationError.message}".`);

    const guiDist = join(root, "gui-dist");
    await mkdir(guiDist);
    await writeFile(join(guiDist, "index.html"), "<!doctype html><title>Kiln</title>", "utf8");
    let modelListenerCalls = 0; let lateFailureObserved = false; let watcherStopCalls = 0; let dedupCloseCalls = 0; let lateFailureError: unknown;
    const originalWatcherStop = CredentialWatcher.prototype.stop; const originalDedupClose = WebhookDedup.prototype.close;
    CredentialWatcher.prototype.stop = function () { watcherStopCalls += 1; return originalWatcherStop.call(this); };
    WebhookDedup.prototype.close = function () { dedupCloseCalls += 1; return originalDedupClose.call(this); };
    try { await startGateway(startupConfig, { guiDistPath: guiDist, modelGatewayExecution, modelGatewayListener: () => { modelListenerCalls += 1; throw new Error("synthetic model bind failure"); } }); }
    catch (error) { lateFailureError = error; lateFailureObserved = error instanceof Error && error.message.includes("synthetic model bind failure"); }
    finally { CredentialWatcher.prototype.stop = originalWatcherStop; WebhookDedup.prototype.close = originalDedupClose; }
    const observedLateFailure = lateFailureError instanceof Error ? lateFailureError.message : String(lateFailureError);
    if (modelListenerCalls !== 1) throw new Error(`Expected Model Gateway listener to run once, observed ${modelListenerCalls} call(s); observed error "${observedLateFailure}".`);
    if (!lateFailureObserved) throw new Error(`Expected synthetic model bind failure, observed error "${observedLateFailure}".`);
    if (watcherStopCalls !== 1) throw new Error(`Expected CredentialWatcher.stop once after late startup failure, observed ${watcherStopCalls} call(s); observed error "${observedLateFailure}".`);
    if (dedupCloseCalls !== 1) throw new Error(`Expected WebhookDedup.close once after late startup failure, observed ${dedupCloseCalls} call(s); observed error "${observedLateFailure}".`);
    console.log("real Bun SQLite durability, fencing, recovery, permissions, and startup cleanup checks passed");
  } finally {
    accountCapacityAuthority.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const mode = process.argv[2];
if (mode === "claimed" || mode === "committed") await child(mode, process.argv[3]!);
else await main();
