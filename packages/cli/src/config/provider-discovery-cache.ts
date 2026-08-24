import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  GuiProviderAuthState,
  GuiProviderDiscoveryResult,
  GuiProviderDiscoveryStatus,
} from "@kilnai/gateway-contracts";
import {
  assertPrivateStateFileTargetSync,
  assertPrivateStateDirectoryTargetSync,
  ensurePrivateStateDirectorySync,
} from "../application/private-project-state-filesystem.js";
import {
  resolveProjectStateBinding,
  type ProjectStateBinding,
  type ProjectStateRootOptions,
} from "../application/project-state-root.js";

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

export interface ProviderDiscoveryCacheOptions extends ProjectStateRootOptions {
  /** Already-established private project-state binding. */
  readonly projectStateBinding?: ProjectStateBinding;
}

export function readProviderDiscoveryCache(
  projectPath: string,
  options: ProviderDiscoveryCacheOptions = {},
): readonly GuiProviderDiscoveryResult[] {
  const binding = resolveProviderBinding(projectPath, options);
  const path = join(binding.cachePath, "provider-discovery.json");
  try {
    if (!assertPrivateStateDirectoryTargetSync(binding.projectStateRoot, binding.cachePath)) {
      return [];
    }
    assertPrivateStateFileTargetSync(binding.projectStateRoot, path);
    if (!existsSync(path)) {
      return [];
    }
    // existsSync is only a presence probe; validate again at the read effect.
    assertPrivateStateFileTargetSync(binding.projectStateRoot, path);
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
  options: ProviderDiscoveryCacheOptions = {},
): void {
  const freshDiscovery = discovery.filter((entry) => entry.status !== "stale");
  if (freshDiscovery.length === 0) {
    return;
  }
  const binding = resolveProviderBinding(projectPath, options);
  const path = join(binding.cachePath, "provider-discovery.json");
  ensurePrivateStateDirectorySync(binding.projectStateRoot, dirname(path));
  const payload: ProviderDiscoveryCacheFile = {
    version: PROVIDER_DISCOVERY_CACHE_VERSION,
    cachedAt: new Date().toISOString(),
    discovery: freshDiscovery,
  };
  // Recheck after payload composition and immediately before the write. The
  // cache path is private state, so a replaced descendant must fail closed.
  assertPrivateStateFileTargetSync(binding.projectStateRoot, path);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

export function providerDiscoveryCachePath(
  projectPath: string,
  options: ProviderDiscoveryCacheOptions = {},
): string {
  return join(resolveProviderBinding(projectPath, options).cachePath, "provider-discovery.json");
}

function resolveProviderBinding(
  projectPath: string,
  options: ProviderDiscoveryCacheOptions,
): ProjectStateBinding {
  return options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options);
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
