import type { McpDiscoverySnapshot, McpDiscoverySnapshotAttestation, ResolvedMcpServer } from "@kilnai/core";
import {
  deriveMcpServerBindingDigest,
  MCP_SERVER_BINDING_PROJECTION_REVISION,
  projectMcpToolCapabilityDiscovery,
  type McpToolCapabilityDiscoveryResult,
} from "@kilnai/core/capabilities";
import {
  createCanonicalMcpClient,
  createMcpCredentialAccess,
} from "./mcp-credentials.js";

export interface CanonicalMcpCapabilityDiscoveryOptions {
  readonly kilnHome?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface CanonicalMcpCapabilityDiscovery {
  /** The unmodified snapshot settled by the MCP client. */
  readonly snapshot: McpDiscoverySnapshot;
  /** The Core-owned, provider-neutral capability discovery result. */
  readonly discovery: McpToolCapabilityDiscoveryResult;
  /** Releases the client owned by this operation. */
  readonly disconnect: () => Promise<void>;
}

/**
 * Discovers one admitted canonical MCP server and projects its settled
 * snapshot through Core without executing any advertised capability.
 *
 * A single credential-access object supplies both the client's resolver and
 * the opaque authorization evidence. When settling or projecting fails, this
 * operation closes the client before rethrowing so failed operations cannot
 * leak a transport.
 */
export async function discoverCanonicalMcpToolCapabilities(
  server: ResolvedMcpServer,
  options: CanonicalMcpCapabilityDiscoveryOptions = {},
): Promise<CanonicalMcpCapabilityDiscovery> {
  const environment = options.environment ?? process.env;
  const credentials = createMcpCredentialAccess(environment, options.kilnHome);
  const authorization = credentials.acquireAuthorizationContext(server);
  const discoveryAttestation: McpDiscoverySnapshotAttestation = {
    bindingDigest: deriveMcpServerBindingDigest(server),
    bindingRevision: MCP_SERVER_BINDING_PROJECTION_REVISION,
    authorizationDigest: authorization.evidence.digest,
    authorizationRevision: authorization.evidence.revision,
  };
  const client = createCanonicalMcpClient(
    server,
    options.kilnHome,
    authorization.credentialResolver,
    authorization.environment,
    discoveryAttestation,
  );
  try {
    const snapshot = await client.discover();
    const discovery = projectMcpToolCapabilityDiscovery({
      evaluatedAt: snapshot.discoveredAt,
      server,
      snapshot,
      authorization: authorization.evidence,
    });
    return {
      snapshot,
      discovery,
      disconnect: () => client.disconnect(),
    };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}
