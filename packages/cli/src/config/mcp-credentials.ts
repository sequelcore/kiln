import { homedir } from "node:os";
import { join } from "node:path";
import { AesSecretStore, KilnMcpClient, type ResolvedMcpServer } from "@kilnai/core";

export const KILN_MCP_SECRET_KEY_ENV = "KILN_MCP_SECRET_KEY";
const MCP_CREDENTIAL_PREFIX = "mcp:";

export interface McpCredentialAccess {
  readonly available: boolean;
  readonly exists: (credentialId: string) => boolean;
  readonly resolve: (credentialId: string) => string | undefined;
  readonly set: (credentialId: string, value: string) => void;
}

export function createMcpCredentialAccess(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  userHome = homedir(),
): McpCredentialAccess {
  const masterKey = environment[KILN_MCP_SECRET_KEY_ENV]?.trim();
  if (!masterKey) {
    return {
      available: false,
      exists: () => false,
      resolve: () => undefined,
      set: () => { throw new Error(`${KILN_MCP_SECRET_KEY_ENV} is required to use Kiln MCP credential references.`); },
    };
  }
  const store = new AesSecretStore(join(userHome, ".kiln", "mcp-secrets.json"), masterKey);
  const key = (credentialId: string) => `${MCP_CREDENTIAL_PREFIX}${credentialId}`;
  return {
    available: true,
    exists: (credentialId) => store.get(key(credentialId)) !== null,
    resolve: (credentialId) => store.get(key(credentialId)) ?? undefined,
    set: (credentialId, value) => store.set(key(credentialId), value),
  };
}

export function createCanonicalMcpClient(server: ResolvedMcpServer): KilnMcpClient {
  const credentials = createMcpCredentialAccess();
  return new KilnMcpClient(server, { credentialResolver: credentials.resolve });
}
