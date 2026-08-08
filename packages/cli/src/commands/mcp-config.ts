import { loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { syncNativeMcpProjections, uninstallNativeMcpProjections, type NativeMcpProjectionTargetResult } from "../config/native-mcp-projection-sync.js";
import type { NativeMcpHarness } from "../config/native-mcp-projection.js";
import type { KilnAppConfig } from "../config.js";
import { createCanonicalMcpClient, createMcpCredentialAccess } from "../config/mcp-credentials.js";
import { recordMcpDiscovery, recordMcpFailure } from "../config/mcp-runtime-state.js";
import {
  syncGlobalControlPlaneMcpProjections,
  type GlobalControlPlaneMcpProjectionTargetResult,
} from "../config/global-control-plane-mcp-projection.js";

export interface McpConfigFlags {
  readonly client?: string;
  readonly name?: string;
  readonly command?: string;
  readonly args?: string;
  readonly test?: boolean;
  readonly server?: string;
  readonly repair?: boolean;
  readonly uninstall?: boolean;
  readonly credential?: string;
  readonly fromEnv?: string;
}

export async function mcpConfigCommand(
  _appConfig: KilnAppConfig,
  flags: McpConfigFlags,
): Promise<void> {
  if (flags.name || flags.command || flags.args) {
    throw new Error("--name, --command, and --args were removed; define MCP servers in canonical global or project Kiln configuration.");
  }
  if (flags.credential || flags.fromEnv) {
    importCredential(flags.credential, flags.fromEnv);
    return;
  }
  const harnesses = parseHarnesses(flags.client);
  if (flags.uninstall) {
    const nativeResult = await uninstallNativeMcpProjections(process.cwd(), {
      harnesses,
      ...(flags.repair ? { force: true } : {}),
    });
    const globalResult = await syncGlobalControlPlaneMcpProjections({
      operation: "uninstall",
      harnesses,
      ...(flags.repair ? { force: true } : {}),
    });
    for (const target of nativeResult.targets) console.log(formatTarget(target));
    for (const target of globalResult.targets) console.log(formatGlobalTarget(target));
    const blocked = [
      ...nativeResult.targets.filter((target) => target.status === "blocked-malformed" || target.status === "drifted"),
      ...globalResult.targets.filter((target) => target.status === "blocked-malformed" || target.status === "drifted" || target.status === "incompatible"),
    ];
    if (blocked.length > 0) throw new Error(`MCP projection uninstall did not complete for: ${blocked.map((target) => target.harness).join(", ")}`);
    return;
  }
  const resolution = loadResolvedKilnMcpConfiguration(process.cwd());
  if (resolution.diagnostics.length > 0) {
    throw new Error(`Canonical MCP configuration is invalid: ${resolution.diagnostics.map((item) => item.code).join(", ")}`);
  }
  if (flags.test) {
    await testCanonicalMcpServers(resolution.servers, flags.server);
    return;
  }
  const globalResult = await syncGlobalControlPlaneMcpProjections({
    operation: "install",
    harnesses,
    projectPath: process.cwd(),
    ...(flags.repair ? { force: true } : {}),
  });
  for (const target of globalResult.targets) console.log(formatGlobalTarget(target));
  const globalBlocked = globalResult.targets.filter((target) =>
    target.status === "blocked-malformed" || target.status === "drifted" || target.status === "incompatible");
  if (globalBlocked.length > 0) {
    throw new Error(`Global control-plane MCP projection did not complete for: ${globalBlocked.map((target) => target.harness).join(", ")}`);
  }
  const result = await syncNativeMcpProjections(
    resolution,
    process.cwd(),
    {
      harnesses,
      ...(flags.repair ? { force: true } : {}),
    },
  );
  for (const target of result.targets) {
    console.log(formatTarget(target));
  }
  const blocked = result.targets.filter((target) =>
    target.status === "blocked-malformed" || target.status === "drifted" || target.status === "incompatible");
  if (blocked.length > 0) {
    throw new Error(`MCP projection did not complete for: ${blocked.map((target) => target.harness).join(", ")}`);
  }
}

async function testCanonicalMcpServers(
  servers: Readonly<Record<string, import("@kilnai/core").ResolvedMcpServer>>,
  selectedId: string | undefined,
): Promise<void> {
  const selected = Object.values(servers).filter((server) =>
    server.enabled
    && server.admission?.state === "admitted"
    && (!selectedId || server.id === selectedId));
  if (selectedId && selected.length === 0) throw new Error(`Enabled admitted MCP server '${selectedId}' was not found.`);
  if (selected.length === 0) throw new Error("No enabled admitted canonical MCP servers are configured.");
  for (const server of selected) {
    const client = createCanonicalMcpClient(server);
    try {
      const snapshot = await client.discover();
      const state = recordMcpDiscovery(process.cwd(), snapshot);
      console.log(JSON.stringify({
        server: server.id,
        health: state.health,
        discovery: state.discovery,
        tools: snapshot.tools.length,
        resources: snapshot.resources.length,
        prompts: snapshot.prompts.length,
      }));
    } catch (error) {
      recordMcpFailure(process.cwd(), server.id, error);
      throw error;
    } finally {
      await client.disconnect();
    }
  }
}

function importCredential(credentialId: string | undefined, environmentName: string | undefined): void {
  if (!credentialId || !environmentName) throw new Error("--credential and --from-env must be used together.");
  const value = process.env[environmentName];
  if (!value) throw new Error(`Environment variable '${environmentName}' is missing or empty.`);
  createMcpCredentialAccess().set(credentialId, value);
  console.log(`Stored encrypted MCP credential '${credentialId}'.`);
}

function parseHarnesses(client: string | undefined): readonly NativeMcpHarness[] {
  switch (client ?? "all") {
    case "all": return ["codex", "claude", "opencode"];
    case "codex": return ["codex"];
    case "claude":
    case "claude-code": return ["claude"];
    case "opencode": return ["opencode"];
    default: throw new Error(`Unsupported MCP projection client: ${client}`);
  }
}

function formatTarget(target: NativeMcpProjectionTargetResult): string {
  return `${target.harness}: ${target.status} (${target.path})${target.reason ? ` - ${target.reason}` : ""}`;
}

function formatGlobalTarget(target: GlobalControlPlaneMcpProjectionTargetResult): string {
  return `${target.harness} global control-plane: ${target.status} (${target.path})${target.reason ? ` - ${target.reason}` : ""}`;
}
