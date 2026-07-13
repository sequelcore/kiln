import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createNativeHarnessInspectionService,
  type NativeHarnessInspectionService,
} from "../application/native-harness-inspection.js";
import type { ManagedJobRecord } from "@kilnai/runtime";
import { createCodexAppManagedJobApplicationComposition } from "../application/codex-app-managed-jobs.js";

const INSPECTION_TOOL_NAMES = [
  "kiln_status_inspect",
  "kiln_work_governance_inspect",
  "kiln_capability_inspect",
] as const;
const MANAGED_JOB_TOOL_NAMES = ["kiln_managed_agent_invoke", "kiln_managed_agent_status"] as const;
const TOOL_NAMES = [...INSPECTION_TOOL_NAMES, ...MANAGED_JOB_TOOL_NAMES] as const;

type CodexAppMcpToolName = typeof TOOL_NAMES[number];

/** The canonical application boundary. The MCP adapter must not reimplement it. */
export interface ManagedJobApplicationPort {
  submit(input: unknown): Promise<ManagedJobRecord>;
  status(id: string): Promise<ManagedJobRecord>;
}

/** Trusted harness identity, supplied by composition rather than MCP arguments. */
export interface CodexAppMcpRequestIdentity {
  readonly callerId: string;
  readonly requestId?: string;
  readonly parent?: { readonly invocationId: string; readonly turnId: string };
}

export interface CodexAppMcpCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: unknown;
  readonly isError?: true;
}

export interface CodexAppMcpServerOptions {
  readonly inspection?: NativeHarnessInspectionService;
  readonly managedJobs?: ManagedJobApplicationPort;
  readonly requestIdentity?: () => CodexAppMcpRequestIdentity;
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
  private readonly managedJobs: ManagedJobApplicationPort | undefined;
  private readonly requestIdentity: () => CodexAppMcpRequestIdentity;
  private requestSequence = 0;
  private readonly sdkLoader: () => Promise<CodexAppMcpSdk>;
  private readonly transportFactory: () => StdioServerTransport;
  private connectedServer: McpServerInstance | undefined;
  private transport: StdioServerTransport | undefined;
  private sdk: CodexAppMcpSdk | undefined;

  constructor(options: CodexAppMcpServerOptions = {}) {
    this.inspection = options.inspection ?? createNativeHarnessInspectionService();
    this.managedJobs = options.managedJobs;
    this.requestIdentity = options.requestIdentity ?? (() => ({ callerId: "codex-app" }));
    this.sdkLoader = options.sdkLoader ?? loadSdk;
    this.transportFactory = options.transportFactory ?? (() => new StdioServerTransport());
  }

  listTools(): readonly { readonly name: CodexAppMcpToolName; readonly description: string; readonly inputSchema: Record<string, unknown>; readonly outputSchema: Record<string, unknown>; readonly annotations: Record<string, boolean> }[] {
    return TOOL_NAMES.map((name) => ({
      name,
      description: descriptionFor(name),
      inputSchema: inputSchemaFor(name),
      outputSchema: { type: "object" },
      annotations: annotationsFor(name),
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
    const identity = this.trustedIdentity();
    const requestId = identity.requestId ?? `codex-app-mcp-${++this.requestSequence}`;
    if (MANAGED_JOB_TOOL_NAMES.includes(name as typeof MANAGED_JOB_TOOL_NAMES[number])) {
      return this.callManagedJobTool(name as typeof MANAGED_JOB_TOOL_NAMES[number], args, identity, requestId);
    }
    if (!isEmptyObject(args)) {
      return this.error("KILN_TOOL_INVALID_REQUEST", "This read-only Kiln inspection tool does not accept arguments.", "Remove request arguments and retry.", requestId);
    }
    if (!INSPECTION_TOOL_NAMES.includes(name as typeof INSPECTION_TOOL_NAMES[number])) {
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

  private trustedIdentity(): CodexAppMcpRequestIdentity {
    try {
      const identity = this.requestIdentity();
      if (!isIdentifier(identity.callerId)) throw new Error("invalid trusted identity");
      return identity;
    } catch {
      return { callerId: "codex-app-unresolved" };
    }
  }

  private async callManagedJobTool(
    name: typeof MANAGED_JOB_TOOL_NAMES[number],
    args: unknown,
    identity: CodexAppMcpRequestIdentity,
    requestId: string,
  ): Promise<CodexAppMcpCallResult> {
    if (!this.managedJobs) return this.error("KILN_MANAGED_JOBS_UNAVAILABLE", "The managed-job application owner is unavailable.", "Restart Codex App after the managed-job application boundary is configured.", requestId);
    try {
      const job = name === "kiln_managed_agent_invoke"
        ? await this.managedJobs.submit(this.invokeRequest(args, identity))
        : await this.managedJobs.status(this.statusRequest(args));
      return this.managedJobSuccess(name, job, identity, requestId);
    } catch (error) {
      const code = applicationCode(error);
      return this.error(code, "The managed-job application request was not accepted.", operatorActionFor(code), requestId);
    }
  }

  private invokeRequest(args: unknown, identity: CodexAppMcpRequestIdentity): Record<string, unknown> {
    if (!isRecord(args) || !hasOnly(args, ["objective", "agentProfileId", "idempotencyKey"]) || typeof args.objective !== "string" || typeof args.agentProfileId !== "string" || typeof args.idempotencyKey !== "string") throw applicationInputError();
    const objective = args.objective.trim();
    const agentProfileId = args.agentProfileId.trim();
    const idempotencyKey = args.idempotencyKey.trim();
    if (objective.length === 0 || objective.length > 12000 || !isIdentifier(agentProfileId) || !isIdentifier(idempotencyKey)) throw applicationInputError();
    return { objective, agentProfileId, idempotencyKey, callerId: identity.callerId, ...(identity.parent ? { parent: identity.parent } : {}) };
  }

  private statusRequest(args: unknown): string {
    if (!isRecord(args) || !hasOnly(args, ["jobId"]) || typeof args.jobId !== "string" || !isIdentifier(args.jobId.trim())) throw applicationInputError();
    return args.jobId.trim();
  }

  private managedJobSuccess(name: typeof MANAGED_JOB_TOOL_NAMES[number], job: ManagedJobRecord, identity: CodexAppMcpRequestIdentity, requestId: string): CodexAppMcpCallResult {
    const structuredContent = {
      operation: name === "kiln_managed_agent_invoke" ? "managed-agent-invoke" : "managed-agent-status",
      job: {
        id: job.id,
        state: job.state,
        agentProfileId: job.agentProfileId,
        routeId: job.routeId,
        governanceSource: job.governanceSource,
        timeoutSource: job.timeoutSource,
        createdAt: job.createdAt,
        observedAt: job.updatedAt,
        ...(job.diagnostic ? { diagnostic: { code: job.diagnostic, operatorAction: operatorActionFor(job.diagnostic) } } : {}),
      },
      evidence: { harness: "codex-app", adapter: "project-local-kiln-mcp", callerId: identity.callerId, requestId },
    };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }
}

export async function startCodexAppMcpServer(): Promise<void> {
  const composition = await createCodexAppManagedJobApplicationComposition();
  const server = new CodexAppMcpServer({
    managedJobs: composition.service,
    inspection: createNativeHarnessInspectionService({ managedProfiles: composition.profiles }),
  });
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
  if (name === "kiln_capability_inspect") return "Read Codex harness capability availability from canonical Kiln status. Read-only; cannot invoke managed agents.";
  if (name === "kiln_managed_agent_invoke") return "Submit bounded managed work through the canonical Kiln managed-job application boundary.";
  return "Read canonical lifecycle status for one managed-job identifier.";
}

function inputSchemaFor(name: CodexAppMcpToolName): Record<string, unknown> {
  if (INSPECTION_TOOL_NAMES.includes(name as typeof INSPECTION_TOOL_NAMES[number])) return emptyObjectSchema();
  if (name === "kiln_managed_agent_invoke") return { type: "object", additionalProperties: false, required: ["objective", "agentProfileId", "idempotencyKey"], properties: { objective: { type: "string", minLength: 1, maxLength: 12000 }, agentProfileId: { type: "string", minLength: 1, maxLength: 200 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 200 } } };
  return { type: "object", additionalProperties: false, required: ["jobId"], properties: { jobId: { type: "string", minLength: 1, maxLength: 200 } } };
}

function annotationsFor(name: CodexAppMcpToolName): Record<string, boolean> {
  if (name === "kiln_managed_agent_invoke") return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function isIdentifier(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value); }
function applicationInputError(): Error & { code: "invalid_request" } { return Object.assign(new Error("invalid request"), { code: "invalid_request" as const }); }
function applicationCode(error: unknown): string { return isRecord(error) && typeof error.code === "string" && /^[a-z_]{3,80}$/u.test(error.code) ? error.code : "internal_adapter_failure"; }
function operatorActionFor(code: string): string {
  const actions: Record<string, string> = {
    invalid_request: "Provide only valid bounded managed-job fields.", project_identity_unavailable: "Restore the trusted project composition boundary.", unknown_job: "Verify the managed-job identifier.", idempotency_conflict: "Use a new idempotency key for different managed work.", governance_unavailable: "Restore authoritative Kiln governance evidence.", governance_not_authoritative: "Refresh authoritative Kiln governance evidence.", admission_denied: "Review the authoritative work-governance policy.", profile_unavailable: "Choose a configured admitted agent profile.", route_unavailable: "Configure an admitted opencode-go managed-agent route.", job_persistence_unavailable: "Restore the managed-job store and retry safely.", job_persistence_corrupt: "Repair the managed-job store before retrying.", provider_rejected: "Review the Runtime managed-agent admission diagnostic.", provider_timeout: "Review the configured managed-agent timeout.", invocation_failed: "Inspect the Runtime managed-agent diagnostic before retrying.", internal_adapter_failure: "Retry safely or inspect Kiln status."
  };
  return actions[code] ?? "Retry safely or inspect Kiln status.";
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
