import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  GuiProviderAuthState,
  GuiProviderDiscoveryResult,
  GuiProviderDiscoveryStatus,
} from "@kilnai/gateway-contracts";

const PROVIDER_DISCOVERY_CACHE_VERSION = 1;

interface ProviderDiscoveryCacheFile {
  readonly version: number;
  readonly cachedAt: string;
  readonly discovery: readonly GuiProviderDiscoveryResult[];
}

const PROVIDER_DISCOVERY_STATUSES: ReadonlySet<string> = new Set<GuiProviderDiscoveryStatus>([
  "available",
  "missing_auth",
  "auth_expired",
  "cli_missing",
  "endpoint_timeout",
  "endpoint_error",
  "empty_model_list",
  "daemon_unreachable",
  "model_selection_not_required",
  "stale",
]);

const PROVIDER_AUTH_STATES: ReadonlySet<string> = new Set<GuiProviderAuthState>([
  "authenticated",
  "missing",
  "expired",
  "not_required",
  "unknown",
]);

export function readProviderDiscoveryCache(projectPath: string): readonly GuiProviderDiscoveryResult[] {
  const path = providerDiscoveryCachePath(projectPath);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isProviderDiscoveryCacheFile(parsed)) {
      return [];
    }
    return parsed.discovery.filter((entry) => entry.status !== "stale");
  } catch {
    return [];
  }
}

export function writeProviderDiscoveryCache(
  projectPath: string,
  discovery: readonly GuiProviderDiscoveryResult[],
): void {
  const freshDiscovery = discovery.filter((entry) => entry.status !== "stale");
  if (freshDiscovery.length === 0) {
    return;
  }
  const path = providerDiscoveryCachePath(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  const payload: ProviderDiscoveryCacheFile = {
    version: PROVIDER_DISCOVERY_CACHE_VERSION,
    cachedAt: new Date().toISOString(),
    discovery: freshDiscovery,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

export function providerDiscoveryCachePath(projectPath: string): string {
  return join(projectPath, ".kiln", "cache", "provider-discovery.json");
}

function isProviderDiscoveryCacheFile(value: unknown): value is ProviderDiscoveryCacheFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === PROVIDER_DISCOVERY_CACHE_VERSION
    && typeof record.cachedAt === "string"
    && Array.isArray(record.discovery)
    && record.discovery.every(isProviderDiscoveryResult);
}

function isProviderDiscoveryResult(value: unknown): value is GuiProviderDiscoveryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.provider === "string"
    && typeof record.available === "boolean"
    && Array.isArray(record.models)
    && record.models.every((model) => typeof model === "string")
    && typeof record.status === "string"
    && PROVIDER_DISCOVERY_STATUSES.has(record.status)
    && typeof record.reason === "string"
    && typeof record.authState === "string"
    && PROVIDER_AUTH_STATES.has(record.authState)
    && typeof record.lastCheckedAt === "string";
}
