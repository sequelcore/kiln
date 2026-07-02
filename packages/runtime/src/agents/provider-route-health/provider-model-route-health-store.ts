import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createProviderModelRouteHealthRecord,
  evaluateProviderModelRouteHealth,
  type ProviderModelRouteOutcome,
  type ProviderModelRouteHealthDecision,
  type ProviderModelRouteHealthRecord,
} from "@kilnai/core";

export interface ProviderModelRouteHealthStoreConfig {
  readonly rootDir?: string;
}

export class ProviderModelRouteHealthStore {
  private readonly rootDir: string;
  private readonly recordsByProvider = new Map<string, readonly ProviderModelRouteHealthRecord[]>();

  constructor(config: ProviderModelRouteHealthStoreConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "route-health");
  }

  async readProviderHealth(providerId: string): Promise<readonly ProviderModelRouteHealthRecord[]> {
    assertSafeProviderId(providerId);
    const cached = this.recordsByProvider.get(providerId);
    if (cached) {
      return cached;
    }

    try {
      const parsed = JSON.parse(await readFile(this.healthFilePath(providerId), "utf8")) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Provider route health for '${providerId}' must be an array`);
      }
      const records = parsed.map((record) => parseProviderModelRouteHealthRecord(record, providerId));
      this.recordsByProvider.set(providerId, records);
      return records;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readRouteHealth(
    providerId: string,
    modelId: string,
  ): Promise<ProviderModelRouteHealthRecord | null> {
    const records = await this.readProviderHealth(providerId);
    return records.find((record) => record.modelId === modelId) ?? null;
  }

  async evaluateRouteHealth(
    providerId: string,
    modelId: string,
  ): Promise<ProviderModelRouteHealthDecision> {
    return evaluateProviderModelRouteHealth(await this.readRouteHealth(providerId, modelId));
  }

  async recordOutcome(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly outcome: ProviderModelRouteOutcome;
    readonly errorMessage?: string;
  }): Promise<ProviderModelRouteHealthRecord> {
    assertSafeProviderId(input.providerId);
    const current = await this.readProviderHealth(input.providerId);
    const previous = current.find((record) => record.modelId === input.modelId);
    const next = createProviderModelRouteHealthRecord({
      providerId: input.providerId,
      modelId: input.modelId,
      previous,
      outcome: input.outcome,
      errorMessage: input.errorMessage,
    });
    const records = [
      ...current.filter((record) => record.modelId !== input.modelId),
      next,
    ].sort((a, b) => a.modelId.localeCompare(b.modelId));
    await this.writeProviderHealth(input.providerId, records);
    return next;
  }

  async writeProviderHealth(
    providerId: string,
    records: readonly ProviderModelRouteHealthRecord[],
  ): Promise<void> {
    assertSafeProviderId(providerId);
    this.recordsByProvider.set(providerId, records);
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.healthFilePath(providerId), `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  private healthFilePath(providerId: string): string {
    return join(this.rootDir, `${providerId}.json`);
  }
}

function parseProviderModelRouteHealthRecord(
  value: unknown,
  providerId: string,
): ProviderModelRouteHealthRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Malformed provider route health record for '${providerId}'`);
  }
  const record = value as Record<string, unknown>;
  if (record.providerId !== providerId || typeof record.modelId !== "string") {
    throw new Error(`Malformed provider route health record for '${providerId}'`);
  }
  return {
    providerId,
    modelId: record.modelId,
    requestCount: typeof record.requestCount === "number" ? record.requestCount : 0,
    lastSuccess: typeof record.lastSuccess === "number" ? record.lastSuccess : null,
    lastFailure: typeof record.lastFailure === "number" ? record.lastFailure : null,
    cooldownUntil: typeof record.cooldownUntil === "number" ? record.cooldownUntil : null,
    lastOutcome: parseProviderModelRouteOutcome(record.lastOutcome),
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

function parseProviderModelRouteOutcome(value: unknown): ProviderModelRouteOutcome | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "ok":
    case "quota-exceeded":
    case "auth-failed":
    case "connection-failed":
      return { type: record.type };
    case "rate-limited":
      return {
        type: "rate-limited",
        ...(typeof record.resetAt === "number" ? { resetAt: record.resetAt } : {}),
      };
    case "transient-unavailable":
    case "request-incompatible":
      return {
        type: record.type,
        ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
      };
    case "unknown-error":
      return {
        type: "unknown-error",
        ...(typeof record.message === "string" ? { message: record.message } : {}),
      };
    default:
      return null;
  }
}

function assertSafeProviderId(providerId: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(providerId)) {
    throw new Error(`Unsafe provider route health id: ${providerId}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
