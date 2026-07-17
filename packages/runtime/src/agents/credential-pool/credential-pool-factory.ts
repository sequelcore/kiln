import { CredentialPool, type Credential, type SelectionStrategy } from "@kilnai/core";
import type { CredentialFileStore } from "./credential-file-store.js";
import type { CredentialHealthStore } from "./credential-health-store.js";

export interface CredentialPoolFactoryConfig<TAuth> {
  readonly fileStore: CredentialFileStore<TAuth>;
  readonly healthStore?: CredentialHealthStore;
}

export interface LoadCredentialPoolOptions {
  readonly strategy?: SelectionStrategy;
}

export class CredentialPoolFactory<TAuth> {
  private readonly fileStore: CredentialFileStore<TAuth>;
  private readonly healthStore?: CredentialHealthStore;

  constructor(config: CredentialPoolFactoryConfig<TAuth>) {
    this.fileStore = config.fileStore;
    this.healthStore = config.healthStore;
  }

  async loadPool(
    providerId: string,
    options?: LoadCredentialPoolOptions,
  ): Promise<CredentialPool<TAuth>> {
    const [files, health] = await Promise.all([
      this.fileStore.readProviderCredentials(providerId),
      this.healthStore?.readProviderHealth(providerId) ?? Promise.resolve([]),
    ]);

    const credentials: Credential<TAuth>[] = files.map((file) => {
      const healthRecord = health.find((record) => record.credentialId === file.id);
      return {
        id: file.id,
        label: file.label,
        providerId: file.providerId,
        source: file.source,
        priority: file.priority,
        tier: file.tier,
        auth: file.auth,
        requestCount: healthRecord?.requestCount ?? 0,
        lastSuccess: healthRecord?.lastSuccess ?? null,
        lastExhausted: healthRecord?.lastExhausted ?? null,
        cooldownUntil: healthRecord?.cooldownUntil ?? null,
        invalidReason: healthRecord?.lastOutcome?.type === "auth-failed" ? "auth-failed" : null,
        softLeaseCount: 0,
      };
    });

    return new CredentialPool<TAuth>(providerId, {
      strategy: options?.strategy,
      credentials,
      statePort: this.healthStore?.createStatePort<TAuth>(providerId),
    });
  }
}
