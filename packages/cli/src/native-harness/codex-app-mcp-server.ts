import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createNativeHarnessInspectionService,
  type NativeHarnessInspectionService,
} from "../application/native-harness-inspection.js";

const TOOL_NAMES = [
  "kiln_status_inspect",
  "kiln_work_governance_inspect",
  "kiln_capability_inspect",
] as const;

type CodexAppMcpToolName = typeof TOOL_NAMES[number];

export interface CodexAppMcpCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: unknown;
  readonly isError?: true;
}

export interface CodexAppMcpServerOptions {
  readonly inspection?: NativeHarnessInspectionService;
  readonly sdkLoader?: () => Promise<CodexAppMcpSdk>;
  readonly transportFactory?: () => StdioServerTransport;
}

export interface CodexAppMcpSdk {
  readonly Server: new (info: { name: string; version: string }, options: { capabilities: Record<string, unknown> }) => McpServerInstance;
  readonly ListToolsRequestSchema: unknown;
  readonly CallToolRequestSchema: unknown;
}

interface McpServerInstance {
  setRequestHandler(schema: unknown, handler: (request: { params: Record<string, unknown> }) => unknown): void;
  connect(transport: StdioServerTransport): Promise<void>;
  close(): Promise<void>;
}

export class CodexAppMcpServer {
  private readonly inspection: NativeHarnessInspectionService;
  private requestSequence = 0;
  private readonly sdkLoader: () => Promise<CodexAppMcpSdk>;
  private readonly transportFactory: () => StdioServerTransport;
  private connectedServer: McpServerInstance | undefined;
  private transport: StdioServerTransport | undefined;
  private sdk: CodexAppMcpSdk | undefined;

  constructor(options: CodexAppMcpServerOptions = {}) {
    this.inspection = options.inspection ?? createNativeHarnessInspectionService();
    this.sdkLoader = options.sdkLoader ?? loadSdk;
    this.transportFactory = options.transportFactory ?? (() => new StdioServerTransport());
  }

  listTools(): readonly { readonly name: CodexAppMcpToolName; readonly description: string; readonly inputSchema: Record<string, unknown>; readonly outputSchema: Record<string, unknown>; readonly annotations: Record<string, boolean> }[] {
    return TOOL_NAMES.map((name) => ({
      name,
      description: descriptionFor(name),
      inputSchema: emptyObjectSchema(),
      outputSchema: { type: "object" },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
  }

  async initialize(): Promise<void> {
    this.sdk = await this.sdkLoader();
  }

  async start(): Promise<void> {
    if (!this.sdk) await this.initialize();
    this.connectedServer = this.createServer();
    this.transport = this.transportFactory();
    await this.connectedServer.connect(this.transport);
  }

  async callTool(name: string, args: unknown): Promise<CodexAppMcpCallResult> {
    const requestId = `codex-app-mcp-${++this.requestSequence}`;
    if (!isEmptyObject(args)) {
      return this.error("KILN_TOOL_INVALID_REQUEST", "This read-only Kiln inspection tool does not accept arguments.", "Remove request arguments and retry.", requestId);
    }
    if (!TOOL_NAMES.includes(name as CodexAppMcpToolName)) {
      if (isMutationOperation(name)) {
        return this.error("KILN_TOOL_READ_ONLY", "Managed-agent invocation and configuration mutation are not admitted on this tool surface.", "Use an approved Kiln operator surface for a separately admitted mutation or invocation.", requestId);
      }
      return this.error("KILN_TOOL_UNSUPPORTED", "This Kiln native-harness operation is unsupported.", "Use one of the discovered read-only Kiln inspection tools.", requestId);
    }
    const result = name === "kiln_status_inspect"
      ? await this.inspection.inspectStatus()
      : name === "kiln_work_governance_inspect"
        ? await this.inspection.inspectWorkGovernance()
        : await this.inspection.inspectCapability();
    return this.success(result, requestId);
  }

  async close(): Promise<void> {
    await this.transport?.close();
    await this.connectedServer?.close();
    this.transport = undefined;
    this.connectedServer = undefined;
    this.sdk = undefined;
  }

  private createServer(): McpServerInstance {
    if (!this.sdk) throw new Error("Codex App MCP server was not initialized");
    const server = new this.sdk.Server(
      { name: "kiln-codex-app", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(this.sdk.ListToolsRequestSchema, async () => ({ tools: this.listTools() }));
    server.setRequestHandler(this.sdk.CallToolRequestSchema, async (request) => {
      const params = request.params as { name?: unknown; arguments?: unknown };
      return await this.callTool(typeof params.name === "string" ? params.name : "", params.arguments ?? {});
    });
    return server;
  }

  private success(value: unknown, requestId: string): CodexAppMcpCallResult {
    const result = value as { evidence: Record<string, unknown> };
    const structuredContent = { ...result, evidence: { ...result.evidence, requestId } };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }

  private error(code: string, message: string, operatorAction: string, requestId: string): CodexAppMcpCallResult {
    const value = { error: { code, message, operatorAction }, evidence: { requestId, harness: "codex-app" } };
    return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: true };
  }
}

export async function startCodexAppMcpServer(): Promise<void> {
  const server = new CodexAppMcpServer();
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });
  await server.start();
}

export { createNativeHarnessInspectionService };

function emptyObjectSchema(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: false };
}

function descriptionFor(name: CodexAppMcpToolName): string {
  if (name === "kiln_status_inspect") return "Read curated canonical Kiln status and setup diagnostics. Read-only; never exposes secrets or paths.";
  if (name === "kiln_work_governance_inspect") return "Read the resolved Kiln work-governance policy. Read-only; cannot start or update work.";
  return "Read Codex harness capability availability from canonical Kiln status. Read-only; cannot invoke managed agents.";
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function isMutationOperation(name: string): boolean {
  return /(?:managed[_ .-]?agent|invoke|config|setup|sync|work[_ .-]?item|goal|mutation|apply)/iu.test(name);
}

async function loadSdk(): Promise<CodexAppMcpSdk> {
  const [serverModule, typesModule] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return {
    Server: serverModule.Server as unknown as CodexAppMcpSdk["Server"],
    ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
    CallToolRequestSchema: typesModule.CallToolRequestSchema,
  };
}
