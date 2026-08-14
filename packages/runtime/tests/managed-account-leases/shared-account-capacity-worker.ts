import { createExecutionAccountRef } from "@kilnai/core";
import { existsSync, writeFileSync } from "node:fs";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";

const [path, id, ready, start, result] = process.argv.slice(-5);
if (!path || !id || !ready || !start || !result) throw new Error("Missing shared-capacity process worker arguments.");
const route = { providerId: "provider", providerModelId: "model", scope: "gateway" };
const authority = new SqliteManagedAccountLeaseAuthority({ path, participantKind: "model-gateway-ingress", recoveryDomain: id, ownerId: id, configurationRevision: "process-test" });
try {
  writeFileSync(ready, "ready");
  while (!existsSync(start)) await new Promise((resolve) => setTimeout(resolve, 10));
  writeFileSync(result, JSON.stringify(authority.acquireAccountCapacity({
    runtimeInvocationId: id,
    intentFingerprint: `sha256:${"a".repeat(64)}`,
    accountPolicyId: "policy",
    route,
    candidates: [{ candidate: { account: createExecutionAccountRef("configured:account"), route, health: "healthy", leaseCapacity: "available", pressure: 0, reservedForNewWork: false }, capacityIdentity: "stable-account", credentialRevisionId: "a".repeat(64), usageEvidence: { health: "healthy", freshness: "missing" }, capacity: { maxConcurrency: 1, reservedAffinitySlots: 0 } }],
  })));
} finally {
  authority.close();
}
