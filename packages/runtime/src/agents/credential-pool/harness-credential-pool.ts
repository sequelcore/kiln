import { homedir } from "node:os";
import { join } from "node:path";
import { CredentialPool, type Credential, type CredentialOutcome } from "@kilnai/core";
import { CredentialFileStore } from "./credential-file-store.js";
import { CredentialHealthStore } from "./credential-health-store.js";
import type { CredentialWatcher } from "./credential-watcher.js";

export type HarnessPoolProviderId = "claude-code" | "codex" | "opencode";

export interface HarnessHomeAuth {
  readonly homeDir: string;
}

export interface HarnessCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly healthStore?: CredentialHealthStore;
  readonly watcher?: CredentialWatcher;
}

export interface HarnessCredentialStatus {
  readonly id: string;
  readonly label: string;
  readonly providerId: HarnessPoolProviderId;
  readonly source: "manual" | "env" | "imported";
  readonly priority: number;
  readonly health?: {
    readonly requestCount: number;
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export class HarnessCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;
  private readonly watcher?: CredentialWatcher;

  constructor(config: HarnessCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
    this.watcher = config.watcher;
  }

  async listStatus(provider: HarnessPoolProviderId): Promise<readonly HarnessCredentialStatus[]> {
    const credentials = await this.resolveCredentials(provider);
    const health = await this.healthStore.readProviderHealth(provider);
    return credentials.map((credential) => {
      const record = health.find((candidate) => candidate.credentialId === credential.id);
      return {
        id: credential.id,
        label: credential.label,
        providerId: provider,
        source: credential.source,
        priority: credential.priority,
        health: record
          ? {
              requestCount: record.requestCount,
              cooldownUntil: record.cooldownUntil,
              lastOutcome: record.lastOutcome,
            }
          : undefined,
      };
    });
  }

  async createPool(provider: HarnessPoolProviderId): Promise<CredentialPool<HarnessHomeAuth>> {
    const pool = new CredentialPool<HarnessHomeAuth>(provider, {
      strategy: "fill-first",
      credentials: await this.resolveCredentials(provider),
      statePort: this.healthStore.createStatePort<HarnessHomeAuth>(provider),
    });
    this.watcher?.onProviderChanged(provider, async () => {
      pool.reloadCredentials(await this.resolveCredentials(provider));
    });
    return pool;
  }

  private async resolveCredentials(provider: HarnessPoolProviderId): Promise<readonly Credential<HarnessHomeAuth>[]> {
    const store = new CredentialFileStore<HarnessHomeAuth>({ rootDir: this.rootDir });
    const fileCredentials = await store.readProviderCredentials(provider);
    return fileCredentials.map((file): Credential<HarnessHomeAuth> => ({
      id: file.id,
      label: file.label,
      providerId: provider,
      source: file.source,
      priority: file.priority,
      tier: file.tier,
      auth: validateAuth(provider, file.auth),
      requestCount: 0,
      lastSuccess: null,
      lastExhausted: null,
      cooldownUntil: null,
      invalidReason: null,
      softLeaseCount: 0,
    }));
  }
}

export function isHarnessPoolProviderId(provider: string): provider is HarnessPoolProviderId {
  return provider === "claude-code" || provider === "codex" || provider === "opencode";
}

function validateAuth(provider: HarnessPoolProviderId, auth: HarnessHomeAuth): HarnessHomeAuth {
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    throw new Error(`Malformed harness credential auth for provider '${provider}'`);
  }
  if (typeof auth.homeDir !== "string" || auth.homeDir.trim().length === 0) {
    throw new Error(`Credential for provider '${provider}' requires homeDir`);
  }
  return { homeDir: auth.homeDir };
}
