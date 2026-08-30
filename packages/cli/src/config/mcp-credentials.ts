import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  KilnMcpClient,
  type McpDiscoverySnapshotAttestation,
  type McpValueReference,
  type ResolvedMcpServer,
} from "@kilnai/core";
import {
  MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION,
  type McpAuthorizationContextEvidence,
} from "@kilnai/core/capabilities";
import { createEncryptedSecretStore } from "@kilnai/runtime";
import { resolveKilnHomePath } from "./global-config/path.js";

export const KILN_MCP_SECRET_KEY_ENV = "KILN_MCP_SECRET_KEY";
const MCP_CREDENTIAL_PREFIX = "mcp:";
const AUTHORIZATION_CONTEXT_KEY = randomBytes(32);
const AUTHORIZATION_CONTEXT_KEY_LENGTH = 32;

export interface McpCredentialAccess {
  readonly available: boolean;
  readonly exists: (credentialId: string) => boolean;
  readonly resolve: (credentialId: string) => string | undefined;
  readonly set: (credentialId: string, value: string) => void;
  readonly acquireAuthorizationContext: (server: ResolvedMcpServer) => McpAuthorizationContextLease;
}

/**
 * Immutable authorization material captured for one client lifecycle. The
 * resolver and environment view are intentionally narrow so callers cannot
 * access the backing credential store or ambient environment through the
 * lease.
 */
export interface McpAuthorizationContextLease {
  readonly evidence: McpAuthorizationContextEvidence;
  readonly credentialResolver: (credentialId: string) => string | undefined;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** Test-only seam for supplying a deterministic in-memory authorization key. */
export interface McpCredentialAccessOptions {
  readonly authorizationKey?: Uint8Array;
}

export function createMcpCredentialAccess(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  kilnHome = resolveKilnHomePath(),
  options: McpCredentialAccessOptions = {},
): McpCredentialAccess {
  const authorizationKey = copyAuthorizationKey(options.authorizationKey);
  const masterKey = environment[KILN_MCP_SECRET_KEY_ENV]?.trim();
  if (!masterKey) {
    const acquireAuthorizationContext = (server: ResolvedMcpServer): McpAuthorizationContextLease =>
      captureAuthorizationContext(server, environment, () => undefined, authorizationKey);
    return {
      available: false,
      exists: () => false,
      resolve: () => undefined,
      set: () => { throw new Error(`${KILN_MCP_SECRET_KEY_ENV} is required to use Kiln MCP credential references.`); },
      acquireAuthorizationContext,
    };
  }
  const store = createEncryptedSecretStore(join(kilnHome, "mcp-secrets.json"), masterKey);
  const key = (credentialId: string) => `${MCP_CREDENTIAL_PREFIX}${credentialId}`;
  const resolve = (credentialId: string): string | undefined => store.get(key(credentialId)) ?? undefined;
  const acquireAuthorizationContext = (server: ResolvedMcpServer): McpAuthorizationContextLease =>
    captureAuthorizationContext(server, environment, resolve, authorizationKey);
  return {
    available: true,
    exists: (credentialId) => store.get(key(credentialId)) !== null,
    resolve,
    set: (credentialId, value) => store.set(key(credentialId), value),
    acquireAuthorizationContext,
  };
}

export function createCanonicalMcpClient(
  server: ResolvedMcpServer,
  kilnHome?: string,
  credentialResolver?: (credentialId: string) => string | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  discoveryAttestation?: McpDiscoverySnapshotAttestation,
): KilnMcpClient {
  const resolve = credentialResolver ?? createMcpCredentialAccess(environment, kilnHome).resolve;
  return new KilnMcpClient(server, {
    environment,
    credentialResolver: resolve,
    ...(discoveryAttestation ? { discoveryAttestation } : {}),
  });
}

interface AuthorizationContextEntry {
  readonly field: "env" | "headers";
  readonly name: string;
  readonly sourceKind: "value" | "fromEnv" | "fromCredential";
  readonly sourceIdentity: string;
  readonly value: string;
}

interface AuthorizationTransportEntry {
  readonly field: "transport" | "command" | "args" | "cwd" | "url";
  readonly index?: number;
  readonly value: string;
}

function copyAuthorizationKey(key: Uint8Array | undefined): Uint8Array {
  const selected = key ?? AUTHORIZATION_CONTEXT_KEY;
  if (selected.byteLength !== AUTHORIZATION_CONTEXT_KEY_LENGTH) {
    throw new TypeError(`MCP authorization context key must be exactly ${AUTHORIZATION_CONTEXT_KEY_LENGTH} bytes.`);
  }
  return new Uint8Array(selected);
}

function captureAuthorizationContext(
  server: ResolvedMcpServer,
  environment: Readonly<Record<string, string | undefined>>,
  resolveCredential: (credentialId: string) => string | undefined,
  authorizationKey: Uint8Array,
): McpAuthorizationContextLease {
  const capturedCredentials = new Map<string, string>();
  const capturedEnvironment = new Map<string, string>();
  const captureEnvironment = (name: string): string | undefined => {
    if (capturedEnvironment.has(name)) return capturedEnvironment.get(name);
    let value: string | undefined;
    try {
      value = environment[name];
    } catch {
      throw missingAuthorizationReference(server.id);
    }
    if (value === undefined) throw missingAuthorizationReference(server.id);
    capturedEnvironment.set(name, value);
    return value;
  };
  const captureCredential = (credentialId: string): string | undefined => {
    if (capturedCredentials.has(credentialId)) return capturedCredentials.get(credentialId);
    let value: string | undefined;
    try {
      value = resolveCredential(credentialId);
    } catch {
      throw missingAuthorizationReference(server.id);
    }
    if (value === undefined) throw missingAuthorizationReference(server.id);
    capturedCredentials.set(credentialId, value);
    return value;
  };
  const entries = [
    ...resolveAuthorizationEntries(server.id, "env", server.env, captureEnvironment, captureCredential),
    ...resolveAuthorizationEntries(server.id, "headers", server.headers, captureEnvironment, captureCredential),
  ].sort(compareAuthorizationContextEntries);
  const transportEntries = resolveAuthorizationTransportEntries(server);

  return Object.freeze({
    evidence: deriveAuthorizationContext(server, entries, transportEntries, authorizationKey),
    credentialResolver: (credentialId: string) => capturedCredentials.get(credentialId),
    environment: Object.freeze(Object.fromEntries(capturedEnvironment)),
  });
}

function deriveAuthorizationContext(
  server: ResolvedMcpServer,
  entries: readonly AuthorizationContextEntry[],
  transportEntries: readonly AuthorizationTransportEntry[],
  authorizationKey: Uint8Array,
): McpAuthorizationContextEvidence {
  const hmac = createHmac("sha256", authorizationKey);
  updateFrame(hmac, "kiln.mcp.authorization-context");
  updateFrame(hmac, MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION);
  updateFrame(hmac, "server");
  updateFrame(hmac, server.id);
  updateFrame(hmac, "transport-material");
  updateFrame(hmac, String(transportEntries.length));
  for (const entry of transportEntries) {
    updateFrame(hmac, "transport-entry");
    updateFrame(hmac, entry.field);
    updateFrame(hmac, entry.index === undefined ? "none" : String(entry.index));
    updateFrame(hmac, entry.value);
  }
  updateFrame(hmac, "resolved-references");
  updateFrame(hmac, String(entries.length));
  for (const entry of entries) {
    updateFrame(hmac, "resolved-reference");
    updateFrame(hmac, entry.field);
    updateFrame(hmac, entry.name);
    updateFrame(hmac, entry.sourceKind);
    updateFrame(hmac, entry.sourceIdentity);
    updateFrame(hmac, entry.value);
  }

  return Object.freeze({
    digest: `sha256:${hmac.digest("hex")}` as McpAuthorizationContextEvidence["digest"],
    revision: MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION,
  });
}

function resolveAuthorizationTransportEntries(server: ResolvedMcpServer): readonly AuthorizationTransportEntry[] {
  const entries: AuthorizationTransportEntry[] = [{ field: "transport", value: server.transport }];
  if (server.command !== undefined) entries.push({ field: "command", value: server.command });
  if (server.args !== undefined) {
    entries.push({ field: "args", value: String(server.args.length) });
    server.args.forEach((value, index) => entries.push({ field: "args", index, value }));
  }
  if (server.cwd !== undefined) entries.push({ field: "cwd", value: server.cwd });
  if (server.url !== undefined) entries.push({ field: "url", value: server.url });
  return entries;
}

function resolveAuthorizationEntries(
  serverId: string,
  field: "env" | "headers",
  references: Readonly<Record<string, McpValueReference>> | undefined,
  resolveEnvironment: (name: string) => string | undefined,
  resolveCredential: (credentialId: string) => string | undefined,
): AuthorizationContextEntry[] {
  return Object.entries(references ?? {}).map(([name, reference]) => {
    if (reference === null || typeof reference !== "object") {
      throw missingAuthorizationReference(serverId);
    }
    if ("value" in reference) {
      return { field, name, sourceKind: "value", sourceIdentity: "literal", value: reference.value };
    }
    if ("fromEnv" in reference) {
      let value: string | undefined;
      try {
        value = resolveEnvironment(reference.fromEnv);
      } catch {
        throw missingAuthorizationReference(serverId);
      }
      if (value === undefined) throw missingAuthorizationReference(serverId);
      return { field, name, sourceKind: "fromEnv", sourceIdentity: reference.fromEnv, value };
    }
    if ("fromCredential" in reference) {
      let value: string | undefined;
      try {
        value = resolveCredential(reference.fromCredential);
      } catch {
        throw missingAuthorizationReference(serverId);
      }
      if (value === undefined) throw missingAuthorizationReference(serverId);
      return { field, name, sourceKind: "fromCredential", sourceIdentity: reference.fromCredential, value };
    }
    throw missingAuthorizationReference(serverId);
  });
}

function missingAuthorizationReference(serverId: string): Error {
  return new Error(`MCP server ${serverId} has an unresolved environment or credential reference`);
}

function compareAuthorizationContextEntries(left: AuthorizationContextEntry, right: AuthorizationContextEntry): number {
  for (const [leftPart, rightPart] of [
    [left.field, right.field],
    [left.name, right.name],
    [left.sourceKind, right.sourceKind],
    [left.sourceIdentity, right.sourceIdentity],
  ] as const) {
    const difference = compareCodeUnits(leftPart, rightPart);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function updateFrame(hmac: ReturnType<typeof createHmac>, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  hmac.update(Buffer.from(`${bytes.byteLength}:`, "ascii"));
  hmac.update(bytes);
}
