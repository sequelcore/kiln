import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Credential, CredentialOutcome, CredentialPoolStatePort, SelectionStrategy } from "@kilnai/core";

export interface CredentialHealthStoreConfig {
  readonly rootDir: string;
}

export interface CredentialHealthRecord {
  readonly providerId: string;
  readonly credentialId: string;
  readonly requestCount: number;
  readonly lastSuccess: number | null;
  readonly lastExhausted: number | null;
  readonly cooldownUntil: number | null;
  readonly lastOutcome: CredentialOutcome | null;
  readonly updatedAt: string;
}

export class CredentialHealthStore {
  private readonly rootDir: string;
  private readonly recordsByProvider = new Map<string, readonly CredentialHealthRecord[]>();

  constructor(config: CredentialHealthStoreConfig) {
    this.rootDir = config.rootDir;
  }

  async readProviderHealth(providerId: string): Promise<readonly CredentialHealthRecord[]> {
    const cached = this.recordsByProvider.get(providerId);
    if (cached) {
      return cached;
    }

    const filePath = this.healthFilePath(providerId);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("health file must contain an array");
      }
      const records = parsed.map((record) => parseHealthRecord(record, providerId));
      this.recordsByProvider.set(providerId, records);
      return records;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async writeProviderHealth(
    providerId: string,
    records: readonly CredentialHealthRecord[],
  ): Promise<void> {
    this.recordsByProvider.set(providerId, records);
    await mkdir(this.healthDirectory(), { recursive: true });
    await writeFile(this.healthFilePath(providerId), `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  async upsertHealth(record: CredentialHealthRecord): Promise<void> {
    const current = this.recordsByProvider.get(record.providerId) ?? [];
    const next = [
      ...current.filter((candidate) => candidate.credentialId !== record.credentialId),
      record,
    ].sort((a, b) => a.credentialId.localeCompare(b.credentialId));
    this.recordsByProvider.set(record.providerId, next);
    await this.writeProviderHealth(record.providerId, next);
  }

  async removeCredentialHealth(providerId: string, credentialId: string): Promise<void> {
    const current = await this.readProviderHealth(providerId);
    await this.writeProviderHealth(
      providerId,
      current.filter((record) => record.credentialId !== credentialId),
    );
  }

  createStatePort<TAuth>(providerId: string): CredentialPoolStatePort<TAuth> {
    return {
      onCredentialAdded: (credential) => {
        void this.upsertHealth(toHealthRecord(providerId, credential, null)).catch(() => {});
      },
      onCredentialRemoved: () => {},
      onLeaseAcquired: () => {},
      onLeaseReleased: () => {},
      onOutcomeReported: (credentialId, outcome, cooldownUntil) => {
        void this.recordOutcome(providerId, credentialId, outcome, cooldownUntil).catch(() => {});
      },
      onSelectionStrategyChanged: (_strategy: SelectionStrategy) => {},
    };
  }

  async recordOutcome(
    providerId: string,
    credentialId: string,
    outcome: CredentialOutcome,
    cooldownUntil: number | null,
  ): Promise<void> {
    const current = this.recordsByProvider.get(providerId) ?? [];
    const previous = current.find((record) => record.credentialId === credentialId);
    const next: CredentialHealthRecord = {
      providerId,
      credentialId,
      requestCount: (previous?.requestCount ?? 0) + 1,
      lastSuccess: outcome.type === "ok" ? Date.now() : previous?.lastSuccess ?? null,
      lastExhausted: cooldownUntil !== null ? Date.now() : previous?.lastExhausted ?? null,
      cooldownUntil,
      lastOutcome: outcome,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertHealth(next);
  }

  private healthDirectory(): string {
    return join(this.rootDir, ".health");
  }

  private healthFilePath(providerId: string): string {
    return join(this.healthDirectory(), `${providerId}.json`);
  }
}

export function toHealthRecord<TAuth>(
  providerId: string,
  credential: Credential<TAuth>,
  lastOutcome: CredentialOutcome | null,
): CredentialHealthRecord {
  return {
    providerId,
    credentialId: credential.id,
    requestCount: credential.requestCount,
    lastSuccess: credential.lastSuccess,
    lastExhausted: credential.lastExhausted,
    cooldownUntil: credential.cooldownUntil,
    lastOutcome,
    updatedAt: new Date().toISOString(),
  };
}

function parseHealthRecord(value: unknown, providerId: string): CredentialHealthRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Malformed credential health record for provider '${providerId}'`);
  }
  const record = value as Record<string, unknown>;
  if (record.providerId !== providerId || typeof record.credentialId !== "string") {
    throw new Error(`Malformed credential health record for provider '${providerId}'`);
  }
  return {
    providerId,
    credentialId: record.credentialId,
    requestCount: typeof record.requestCount === "number" ? record.requestCount : 0,
    lastSuccess: typeof record.lastSuccess === "number" ? record.lastSuccess : null,
    lastExhausted: typeof record.lastExhausted === "number" ? record.lastExhausted : null,
    cooldownUntil: typeof record.cooldownUntil === "number" ? record.cooldownUntil : null,
    lastOutcome: isCredentialOutcome(record.lastOutcome) ? record.lastOutcome : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

function isCredentialOutcome(value: unknown): value is CredentialOutcome {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && typeof (value as { readonly type?: unknown }).type === "string";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
