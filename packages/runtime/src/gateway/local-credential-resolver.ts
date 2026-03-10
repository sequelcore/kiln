// Infrastructure: resolves credentials from Kiln's local SecretStore
// Used in self-hosted / OpenKiln deployments where Kiln owns the credential store

import type { CredentialResolver, ResolvedCredential } from "@kilnai/core";
import type { SecretStore } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

export class LocalCredentialResolver implements CredentialResolver {
  constructor(private readonly secretStore: SecretStore) {}

  async resolve(tenantId: string, credentialKey: string): Promise<ResolvedCredential> {
    const secretKey = `tenant:${tenantId}:integration:${credentialKey}`;
    const value = this.secretStore.get(secretKey);
    if (value === null) {
      throw new KilnError("CREDENTIAL_RESOLVE_FAILED", `No credential found for key "${credentialKey}"`, {
        context: { tenantId, credentialKey },
        retryable: false,
      });
    }
    try {
      return JSON.parse(value) as ResolvedCredential;
    } catch {
      // Plain string fallback — treat as bearer token
      return { type: "bearer", value };
    }
  }

  invalidate(_tenantId: string, _credentialKey: string): void {
    // Local store is read-through; no cache to invalidate
  }
}
