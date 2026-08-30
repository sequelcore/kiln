import {
  KilnMcpClient,
  type KilnMcpClientOptions,
  MCP_PROTOCOL_REVISION,
  type McpSdkClient,
  type McpTransportDescriptor,
  type McpTransportHandle,
  type ResolvedMcpServer,
} from "@kilnai/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export type RuntimeKilnMcpClientOptions = Omit<
  KilnMcpClientOptions,
  "sdkClient" | "makeTransport" | "installListChangedHandler"
>;

export function createKilnMcpClient(
  server: ResolvedMcpServer,
  options: RuntimeKilnMcpClientOptions = {},
): KilnMcpClient {
  let onListChanged = async (): Promise<void> => undefined;
  const sdkClient = new Client(
    { name: options.clientName ?? "kiln", version: options.clientVersion ?? "3.0.0" },
    {
      capabilities: {},
      versionNegotiation: { mode: { pin: MCP_PROTOCOL_REVISION } },
      listChanged: {
        tools: { onChanged: () => void onListChanged() },
        resources: { onChanged: () => void onListChanged() },
        prompts: { onChanged: () => void onListChanged() },
      },
    },
  ) as unknown as McpSdkClient;

  return new KilnMcpClient(server, {
    ...options,
    sdkClient,
    makeTransport: createMcpTransport,
    installListChangedHandler(handler) {
      onListChanged = handler;
    },
  });
}

function createMcpTransport(descriptor: McpTransportDescriptor): McpTransportHandle {
  if (descriptor.kind === "stdio") {
    const transport = new StdioClientTransport({
      command: descriptor.command,
      args: [...descriptor.args],
      ...(descriptor.cwd ? { cwd: descriptor.cwd } : {}),
      ...(descriptor.env ? { env: { ...getDefaultEnvironment(), ...descriptor.env } } : {}),
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: unknown) => descriptor.onStderr(String(chunk)));
    return transport;
  }

  const reconnect = descriptor.reconnect;
  return new StreamableHTTPClientTransport(descriptor.url, {
    protocolVersion: MCP_PROTOCOL_REVISION,
    ...(descriptor.headers ? { requestInit: { headers: { ...descriptor.headers } } } : {}),
    ...(reconnect
      ? {
          reconnectionOptions: {
            maxRetries: reconnect.maxAttempts,
            initialReconnectionDelay: reconnect.initialDelayMs ?? 1_000,
            maxReconnectionDelay: reconnect.maxDelayMs ?? 30_000,
            reconnectionDelayGrowFactor: 1.5,
          },
        }
      : {}),
  });
}
