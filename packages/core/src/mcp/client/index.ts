import type {
  CallToolRequest,
  CallToolResult,
  CacheableRequestOptions,
  CallToolRequestOptions,
  GetPromptRequest,
  GetPromptResult,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListToolsRequest,
  ListToolsResult,
  ProtocolEra,
  ReadResourceRequest,
  ReadResourceResult,
  RequestOptions,
} from "@modelcontextprotocol/client";
import type { Capability } from "../../engine/domain/capability.js";
import type { PromptScanner } from "../../security/prompt-scanner.js";
import {
  formatMcpCapabilitySelector,
  resolveMcpToolEffect,
  type McpCapabilityKind,
  type McpValueReference,
  type ResolvedMcpServer,
} from "../index.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const STDERR_CAPTURE_LIMIT = 8_192;
const RESPONSE_SIZE_LIMIT_BYTES = 1_048_576;
const DEFAULT_CAPABILITY_LIMIT = 128;
const MAX_DISCOVERY_CAPABILITIES = 10_000;
const MAX_DISCOVERY_PAGES = 128;
const MAX_DISCOVERY_CURSOR_LENGTH = 4_096;
/** The only MCP wire revision admitted by the Core client. */
export const MCP_PROTOCOL_REVISION = "2026-07-28" as const;

export type McpClientErrorCode =
  | "MCP_NOT_ADMITTED"
  | "MCP_CONNECTION_FAILED"
  | "MCP_STARTUP_TIMEOUT"
  | "MCP_REQUEST_FAILED"
  | "MCP_CATALOG_LIMIT_EXCEEDED"
  | "MCP_SELECTOR_INVALID"
  | "MCP_CAPABILITY_NOT_FOUND"
  | "MCP_RESPONSE_TOO_LARGE"
  | "MCP_CATALOG_CHANGED"
  | "MCP_SECRET_REFERENCE_MISSING"
  | "MCP_PROTOCOL_UNSUPPORTED";

export class KilnMcpClientError extends Error {
  readonly code: McpClientErrorCode;
  readonly serverId: string;

  constructor(code: McpClientErrorCode, serverId: string, message: string) {
    super(message);
    this.name = "KilnMcpClientError";
    this.code = code;
    this.serverId = serverId;
  }
}

export type McpRequestOptions = RequestOptions;

export interface McpSdkClient {
  connect(transport: McpTransportHandle, options?: { readonly signal?: AbortSignal; readonly timeout?: number }): Promise<void>;
  close(): Promise<void>;
  listTools(params?: ListToolsRequest["params"], options?: CacheableRequestOptions): Promise<ListToolsResult>;
  listResources(params?: ListResourcesRequest["params"], options?: CacheableRequestOptions): Promise<ListResourcesResult>;
  listPrompts(params?: ListPromptsRequest["params"], options?: CacheableRequestOptions): Promise<ListPromptsResult>;
  callTool(params: CallToolRequest["params"], options?: CallToolRequestOptions): Promise<CallToolResult>;
  readResource(params: ReadResourceRequest["params"], options?: CacheableRequestOptions): Promise<ReadResourceResult>;
  getPrompt(params: GetPromptRequest["params"], options?: RequestOptions): Promise<GetPromptResult>;
  getServerVersion(): { readonly name: string; readonly version: string } | undefined;
  getNegotiatedProtocolVersion(): string | undefined;
  getProtocolEra(): ProtocolEra | undefined;
}

export interface McpTransportHandle {
  close(): Promise<void>;
}

export type McpTransportDescriptor =
  | {
      readonly kind: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
      readonly onStderr: (chunk: string) => void;
    }
  | {
      readonly kind: "streamable-http";
      readonly url: URL;
      readonly headers?: Readonly<Record<string, string>>;
      readonly reconnect?: ResolvedMcpServer["reconnect"];
    };

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations?: Readonly<Record<string, unknown>>;
}

export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly { readonly name: string; readonly description?: string; readonly required?: boolean }[];
}

export interface QualifiedMcpCapability<T> {
  readonly serverId: string;
  readonly kind: McpCapabilityKind;
  readonly selector: string;
  readonly descriptor: T;
  /** Server annotations are retained only as untrusted evidence, never as authority. */
  readonly annotations?: Readonly<Record<string, unknown>>;
}

export interface McpDiscoverySnapshot {
  readonly serverId: string;
  readonly tools: readonly QualifiedMcpCapability<McpToolDescriptor>[];
  readonly resources: readonly QualifiedMcpCapability<McpResourceDescriptor>[];
  readonly prompts: readonly QualifiedMcpCapability<McpPromptDescriptor>[];
  readonly protocolRevision: typeof MCP_PROTOCOL_REVISION;
  readonly completeness: "complete";
  readonly invalidated: boolean;
  readonly discoveredAt: string;
  readonly freshness: {
    readonly observedAt: string;
    readonly validUntil?: string;
    readonly ttlMs?: number;
    readonly cacheScope?: "public" | "private";
  };
  readonly serverIdentity?: { readonly name: string; readonly version: string };
  readonly catalog?: readonly {
    readonly selector: string;
    readonly kind: McpCapabilityKind;
    readonly name: string;
    readonly admitted: boolean;
  }[];
}

/**
 * Opaque evidence settled by one Kiln MCP client lifecycle. The values are
 * intentionally kept outside the public snapshot so a serialized or copied
 * object cannot be promoted back into capability authority.
 */
export interface McpDiscoverySnapshotAttestation {
  readonly bindingDigest: `sha256:${string}`;
  readonly bindingRevision: string;
  readonly authorizationDigest: `sha256:${string}`;
  readonly authorizationRevision: string;
}

const AUTHENTIC_MCP_DISCOVERY_SNAPSHOTS = new WeakMap<object, McpDiscoverySnapshotAttestation | undefined>();

/** Returns only snapshots settled by this Core MCP client. */
export function assertMcpDiscoverySnapshot(value: unknown): McpDiscoverySnapshot {
  if (!value || typeof value !== "object" || !AUTHENTIC_MCP_DISCOVERY_SNAPSHOTS.has(value)) {
    throw new TypeError("MCP discovery snapshot must be settled by a Kiln MCP client.");
  }
  return value as McpDiscoverySnapshot;
}

/** Reads the private lifecycle evidence for a Core-built snapshot. */
export function readMcpDiscoverySnapshotAttestation(
  value: unknown,
): McpDiscoverySnapshotAttestation | undefined {
  assertMcpDiscoverySnapshot(value);
  return AUTHENTIC_MCP_DISCOVERY_SNAPSHOTS.get(value as object);
}

export interface KilnMcpClientOptions {
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly credentialResolver?: (credentialId: string) => string | undefined;
  readonly promptScanner?: PromptScanner;
  readonly sdkClient: McpSdkClient;
  readonly makeTransport: (descriptor: McpTransportDescriptor) => McpTransportHandle;
  readonly installListChangedHandler?: (handler: () => Promise<void>) => void;
  readonly onDiscoveryChanged?: (snapshot: McpDiscoverySnapshot) => void | Promise<void>;
  /** Optional capability evidence captured for this exact client lifecycle. */
  readonly discoveryAttestation?: McpDiscoverySnapshotAttestation;
}

export class KilnMcpClient {
  readonly serverName: string;
  private readonly server: ResolvedMcpServer;
  private readonly options: KilnMcpClientOptions;
  private readonly discoveryAttestation: McpDiscoverySnapshotAttestation | undefined;
  private readonly sdk: McpSdkClient;
  private transport: McpTransportHandle | undefined;
  private connectPromise: Promise<void> | undefined;
  private disconnectPromise: Promise<void> | undefined;
  private connected = false;
  private stderr = "";
  private catalogInvalidated = false;
  private catalogInvalidationRevision = 0;

  constructor(server: ResolvedMcpServer, options: KilnMcpClientOptions) {
    this.server = server;
    this.serverName = server.id;
    this.options = options;
    this.discoveryAttestation = options.discoveryAttestation === undefined
      ? undefined
      : Object.freeze({ ...options.discoveryAttestation });
    this.sdk = options.sdkClient;
    options.installListChangedHandler?.(() => this.handleListChanged());
  }

  async connect(options: { readonly signal?: AbortSignal } = {}): Promise<void> {
    if (this.disconnectPromise) await this.disconnectPromise;
    if (this.connected) return;
    if (!this.server.enabled || this.server.admission?.state !== "admitted") {
      throw new KilnMcpClientError("MCP_NOT_ADMITTED", this.server.id, `MCP server ${this.server.id} is not admitted`);
    }
    this.connectPromise ??= this.connectOnce(options.signal);
    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise;
    const pending = (async () => {
      const transport = this.transport;
      this.transport = undefined;
      this.connected = false;
      this.connectPromise = undefined;
      try {
        await this.sdk.close();
      } finally {
        if (transport && typeof transport.close === "function") {
          await transport.close().catch(() => undefined);
        }
      }
    })();
    this.disconnectPromise = pending;
    try {
      await pending;
    } finally {
      if (this.disconnectPromise === pending) this.disconnectPromise = undefined;
    }
  }

  async discover(options: { readonly signal?: AbortSignal } = {}): Promise<McpDiscoverySnapshot> {
    return this.settleDiscovery(options, true);
  }

  private async settleDiscovery(
    options: { readonly signal?: AbortSignal },
    clearInvalidation: boolean,
  ): Promise<McpDiscoverySnapshot> {
    const startingInvalidationRevision = this.catalogInvalidationRevision;
    await this.connect(options);
    const request = this.discoveryRequestOptions(options.signal);
    try {
      const capabilityLimit = this.discoveryCapabilityLimit();
      const collectionBudget: DiscoveryCollectionBudget = {
        remaining: Math.min(capabilityLimit, MAX_DISCOVERY_CAPABILITIES),
      };
      const [toolPage, resourcePage, promptPage] = await Promise.all([
        this.listTools(request, collectionBudget),
        collectPages<McpResourceDescriptor>(
          (cursor) => this.sdk.listResources(cursor ? { cursor } : undefined, request),
          "resources",
          collectionBudget,
          this.server.id,
        ),
        collectPages<McpPromptDescriptor>(
          (cursor) => this.sdk.listPrompts(cursor ? { cursor } : undefined, request),
          "prompts",
          collectionBudget,
          this.server.id,
        ),
      ]);
      const tools = toolPage.values;
      const resources = resourcePage.values;
      const prompts = promptPage.values;
      const serverIdentity = this.sdk.getServerVersion?.();
      const capabilityCount = tools.length + resources.length + prompts.length;
      if (capabilityCount > capabilityLimit) {
        throw new KilnMcpClientError(
          "MCP_CATALOG_LIMIT_EXCEEDED",
          this.server.id,
          `MCP server '${this.server.id}' advertised ${capabilityCount} capabilities, exceeding the configured limit of ${capabilityLimit}.`,
        );
      }
      const catalog = [
        ...tools.map((tool) => ({ selector: formatMcpCapabilitySelector(this.server.id, "tool", tool.name), kind: "tool" as const, name: tool.name, admitted: this.isCapabilityAdmitted("tool", tool.name) })),
        ...resources.map((resource) => ({ selector: formatMcpCapabilitySelector(this.server.id, "resource", resource.uri), kind: "resource" as const, name: resource.uri, admitted: this.isCapabilityAdmitted("resource", resource.uri) })),
        ...prompts.map((prompt) => ({ selector: formatMcpCapabilitySelector(this.server.id, "prompt", prompt.name), kind: "prompt" as const, name: prompt.name, admitted: this.isCapabilityAdmitted("prompt", prompt.name) })),
      ];
      const discoveredAt = new Date().toISOString();
      const invalidated = !clearInvalidation
        || startingInvalidationRevision !== this.catalogInvalidationRevision;
      const snapshot: McpDiscoverySnapshot = {
        serverId: this.server.id,
        tools: tools
          .filter((tool) => this.isCapabilityAdmitted("tool", tool.name))
          .filter((tool) => this.isDescriptionAdmissible(tool.description))
          .map((tool) => ({
            serverId: this.server.id,
            kind: "tool" as const,
            selector: formatMcpCapabilitySelector(this.server.id, "tool", tool.name),
            descriptor: withoutAnnotations(tool),
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        resources: resources.filter((resource) => this.isCapabilityAdmitted("resource", resource.uri)).map((resource) => ({
          serverId: this.server.id,
          kind: "resource" as const,
          selector: formatMcpCapabilitySelector(this.server.id, "resource", resource.uri),
          descriptor: resource,
        })),
        prompts: prompts.filter((prompt) => this.isCapabilityAdmitted("prompt", prompt.name)).map((prompt) => ({
          serverId: this.server.id,
          kind: "prompt" as const,
          selector: formatMcpCapabilitySelector(this.server.id, "prompt", prompt.name),
          descriptor: prompt,
        })),
        protocolRevision: MCP_PROTOCOL_REVISION,
        completeness: "complete",
        invalidated,
        discoveredAt,
        freshness: deriveDiscoveryFreshness(discoveredAt, [toolPage, resourcePage, promptPage]),
        ...(serverIdentity ? { serverIdentity } : {}),
        catalog,
      };
      if (!invalidated) this.catalogInvalidated = false;
      return settleMcpDiscoverySnapshot(snapshot, this.discoveryAttestation);
    } catch (error) {
      throw this.requestFailure(error);
    }
  }

  async callTool(selector: string, args: Record<string, unknown>, options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}): Promise<unknown> {
    this.assertCatalogCurrent();
    const name = this.parseSelector(selector, "tool");
    this.assertCapabilityAdmitted("tool", name);
    await this.connect(options);
    try {
      return assertBoundedResponse(await this.sdk.callTool({ name, arguments: args }, this.requestOptions(options.signal, options.timeoutMs)), this.server.id);
    } catch (error) {
      throw this.requestFailure(error);
    }
  }

  async readResource(selector: string, options: { readonly signal?: AbortSignal } = {}): Promise<unknown> {
    this.assertCatalogCurrent();
    const uri = this.parseSelector(selector, "resource");
    this.assertCapabilityAdmitted("resource", uri);
    await this.connect(options);
    try {
      return assertBoundedResponse(await this.sdk.readResource({ uri }, this.requestOptions(options.signal)), this.server.id);
    } catch (error) {
      throw this.requestFailure(error);
    }
  }

  async getPrompt(selector: string, args?: Record<string, string>, options: { readonly signal?: AbortSignal } = {}): Promise<unknown> {
    this.assertCatalogCurrent();
    const name = this.parseSelector(selector, "prompt");
    this.assertCapabilityAdmitted("prompt", name);
    await this.connect(options);
    try {
      return assertBoundedResponse(await this.sdk.getPrompt({ name, ...(args ? { arguments: args } : {}) }, this.requestOptions(options.signal)), this.server.id);
    } catch (error) {
      throw this.requestFailure(error);
    }
  }

  /** Callable provider-neutral projection of every separately admitted MCP capability kind. */
  async discoverProviderCapabilities(): Promise<readonly Capability[]> {
    const snapshot = await this.discover();
    return [
      ...snapshot.tools.map(({ selector, descriptor, annotations }) => ({
        name: selector,
        description: descriptor.description ?? `MCP tool: ${descriptor.name}`,
        schema: descriptor.inputSchema,
        tags: ["mcp", this.server.id, "tool", ...mcpHintTags(annotations)],
        effectEnvelope: resolveMcpToolEffect(this.server, descriptor.name),
      })),
      ...snapshot.resources.map(({ selector, descriptor }) => ({
        name: selector,
        description: descriptor.description ?? `Read MCP resource ${descriptor.name}`,
        schema: { type: "object", additionalProperties: false },
        tags: ["mcp", this.server.id, "resource"],
      })),
      ...snapshot.prompts.map(({ selector, descriptor }) => ({
        name: selector,
        description: descriptor.description ?? `Get MCP prompt ${descriptor.name}`,
        schema: {
          type: "object",
          properties: Object.fromEntries((descriptor.arguments ?? []).map((argument) => [
            argument.name,
            { type: "string", ...(argument.description ? { description: argument.description } : {}) },
          ])),
          required: (descriptor.arguments ?? []).filter((argument) => argument.required).map((argument) => argument.name),
          additionalProperties: false,
        },
        tags: ["mcp", this.server.id, "prompt"],
      })),
    ];
  }

  async executeCapability(selector: string, args: Record<string, unknown>): Promise<unknown> {
    if (selector.startsWith(`mcp:${this.server.id}:tool:`)) {
      const requestedTimeout = args["timeout"];
      const configuredTimeout = this.server.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timeoutMs = typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.max(configuredTimeout, Math.ceil(requestedTimeout + 30_000))
        : configuredTimeout;
      return unwrapToolResult(await this.callTool(selector, args, { timeoutMs }), this.server.id);
    }
    if (selector.startsWith(`mcp:${this.server.id}:resource:`)) return this.readResource(selector);
    if (selector.startsWith(`mcp:${this.server.id}:prompt:`)) {
      const promptArgs = Object.fromEntries(Object.entries(args).map(([name, value]) => {
        if (typeof value !== "string") {
          throw new KilnMcpClientError("MCP_SELECTOR_INVALID", this.server.id, "MCP prompt arguments must be strings");
        }
        return [name, value];
      }));
      return this.getPrompt(selector, promptArgs);
    }
    throw new KilnMcpClientError("MCP_SELECTOR_INVALID", this.server.id, "MCP capability selector is invalid");
  }

  private async connectOnce(signal?: AbortSignal): Promise<void> {
    const descriptor = this.transportDescriptor();
    const transport = this.options.makeTransport(descriptor);
    this.transport = transport;
    const timeoutMs = this.server.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    const timeoutController = new AbortController();
    const combinedSignal = combineSignals(signal, timeoutController.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timeoutController.abort();
          reject(new KilnMcpClientError(
            "MCP_STARTUP_TIMEOUT",
            this.server.id,
            `MCP server ${this.server.id} did not start within its configured timeout`,
          ));
        }, timeoutMs);
      });
      await Promise.race([this.sdk.connect(transport, { signal: combinedSignal, timeout: timeoutMs }), timeout]);
      if (
        this.sdk.getNegotiatedProtocolVersion() !== MCP_PROTOCOL_REVISION ||
        this.sdk.getProtocolEra() !== "modern"
      ) {
        throw new KilnMcpClientError(
          "MCP_PROTOCOL_UNSUPPORTED",
          this.server.id,
          `MCP server ${this.server.id} did not negotiate protocol revision ${MCP_PROTOCOL_REVISION}`,
        );
      }
      this.connected = true;
    } catch (error) {
      await transport.close().catch(() => undefined);
      this.transport = undefined;
      if (error instanceof KilnMcpClientError) throw error;
      throw new KilnMcpClientError("MCP_CONNECTION_FAILED", this.server.id, `MCP server ${this.server.id} failed to connect`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private transportDescriptor(): McpTransportDescriptor {
    if (this.server.transport === "stdio") {
      return {
        kind: "stdio",
        command: this.server.command!,
        args: [...(this.server.args ?? [])],
        ...(this.server.cwd ? { cwd: this.server.cwd } : {}),
        ...(this.server.env ? { env: this.resolveValues(this.server.env) } : {}),
        onStderr: (chunk) => {
          this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_CAPTURE_LIMIT);
        },
      };
    }
    return {
      kind: "streamable-http",
      url: parseHttpUrl(this.server),
      ...(this.server.headers ? { headers: this.resolveValues(this.server.headers) } : {}),
      ...(this.server.reconnect ? { reconnect: this.server.reconnect } : {}),
    };
  }

  private resolveValues(values: Readonly<Record<string, McpValueReference>>): Readonly<Record<string, string>> {
    return Object.fromEntries(Object.entries(values).map(([name, reference]) => {
      if ("value" in reference) return [name, reference.value];
      const value = "fromEnv" in reference
        ? this.options.environment?.[reference.fromEnv]
        : this.options.credentialResolver?.(reference.fromCredential);
      if (value === undefined) {
        throw new KilnMcpClientError(
          "MCP_SECRET_REFERENCE_MISSING",
          this.server.id,
          `MCP server ${this.server.id} has an unresolved environment or credential reference`,
        );
      }
      return [name, value];
    }));
  }

  private requestOptions(signal?: AbortSignal, timeoutMs?: number): McpRequestOptions {
    return {
      ...(signal ? { signal } : {}),
      timeout: timeoutMs ?? this.server.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
      onprogress: () => undefined,
    };
  }

  private discoveryRequestOptions(signal?: AbortSignal): CacheableRequestOptions {
    return { ...this.requestOptions(signal), cacheMode: "refresh" };
  }

  private parseSelector(selector: string, expectedKind: McpCapabilityKind): string {
    const prefix = `mcp:${this.server.id}:${expectedKind}:`;
    if (!selector.startsWith(prefix)) {
      throw new KilnMcpClientError(
        "MCP_SELECTOR_INVALID",
        this.server.id,
        `MCP capability selector must be qualified for server ${this.server.id}`,
      );
    }
    const encoded = selector.slice(prefix.length);
    if (!encoded) {
      throw new KilnMcpClientError("MCP_SELECTOR_INVALID", this.server.id, "MCP capability selector is invalid");
    }
    try {
      return decodeURIComponent(encoded);
    } catch {
      throw new KilnMcpClientError("MCP_SELECTOR_INVALID", this.server.id, "MCP capability selector is invalid");
    }
  }

  private requestFailure(error: unknown): KilnMcpClientError {
    if (error instanceof KilnMcpClientError) return error;
    return new KilnMcpClientError("MCP_REQUEST_FAILED", this.server.id, `MCP request to server ${this.server.id} failed`);
  }

  private isDescriptionAdmissible(description: string | undefined): boolean {
    if (!description || !this.options.promptScanner) return true;
    const result = this.options.promptScanner.scanHeuristic(description);
    if (!result.safe) {
      console.warn(`MCP tool from server ${this.server.id} was excluded because its untrusted description failed inspection`);
    }
    return result.safe;
  }

  private assertCapabilityAdmitted(kind: McpCapabilityKind, name: string): void {
    if (!this.isCapabilityAdmitted(kind, name)) {
      throw new KilnMcpClientError(
        "MCP_NOT_ADMITTED",
        this.server.id,
        `MCP ${kind} is not admitted for server ${this.server.id}`,
      );
    }
  }

  private assertCatalogCurrent(): void {
    if (this.catalogInvalidated) {
      throw new KilnMcpClientError(
        "MCP_CATALOG_CHANGED",
        this.server.id,
        `MCP server ${this.server.id} changed its capability catalog; rediscovery and policy review are required`,
      );
    }
  }

  private isCapabilityAdmitted(kind: McpCapabilityKind, name: string): boolean {
    if (this.server.admission?.state !== "admitted") return false;
    const list = this.server.admission[kind === "tool" ? "tools" : kind === "resource" ? "resources" : "prompts"];
    if (list?.deny?.includes(name)) return false;
    return list?.allow ? list.allow.includes(name) : true;
  }

  private discoveryCapabilityLimit(): number {
    const configured = this.server.maxCapabilities ?? DEFAULT_CAPABILITY_LIMIT;
    if (!Number.isSafeInteger(configured) || configured < 0) {
      throw new KilnMcpClientError(
        "MCP_CATALOG_LIMIT_EXCEEDED",
        this.server.id,
        `MCP server '${this.server.id}' has an invalid capability limit.`,
      );
    }
    return configured;
  }

  private listTools(
    options: McpRequestOptions,
    budget: DiscoveryCollectionBudget,
  ): Promise<CollectedMcpPage<McpToolDescriptor>> {
    return collectPages<McpToolDescriptor>(
      (cursor) => this.sdk.listTools(cursor ? { cursor } : undefined, options),
      "tools",
      budget,
      this.server.id,
    );
  }

  private async handleListChanged(): Promise<void> {
    if (!this.connected) return;
    this.catalogInvalidated = true;
    this.catalogInvalidationRevision += 1;
    try {
      const snapshot = await this.settleDiscovery({}, false);
      await this.options.onDiscoveryChanged?.(snapshot);
    } catch {
      // The synchronous invalidation remains authoritative until an explicit
      // caller performs and adopts a fresh discovery.
    }
  }
}

function assertBoundedResponse<T>(value: T, serverId: string): T {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > RESPONSE_SIZE_LIMIT_BYTES) {
    throw new KilnMcpClientError(
      "MCP_RESPONSE_TOO_LARGE",
      serverId,
      `MCP response from server ${serverId} exceeded the configured safety limit`,
    );
  }
  return value;
}

export class McpCapabilityRegistry {
  private readonly clients: ReadonlyMap<string, KilnMcpClient>;

  constructor(clients: readonly KilnMcpClient[]) {
    const entries = clients.map((client) => [client.serverName, client] as const);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) {
      throw new Error("MCP registry contains duplicate server identities");
    }
    this.clients = new Map(entries);
  }

  async discover(options: { readonly signal?: AbortSignal } = {}): Promise<readonly McpDiscoverySnapshot[]> {
    return Promise.all([...this.clients.values()].map((client) => client.discover(options)));
  }

  async callTool(selector: string, args: Record<string, unknown>, options: { readonly signal?: AbortSignal } = {}): Promise<unknown> {
    const client = this.clientForSelector(selector, "tool");
    return client.callTool(selector, args, options);
  }

  async readResource(selector: string, options: { readonly signal?: AbortSignal } = {}): Promise<unknown> {
    return this.clientForSelector(selector, "resource").readResource(selector, options);
  }

  async getPrompt(selector: string, args?: Record<string, string>, options: { readonly signal?: AbortSignal } = {}): Promise<unknown> {
    return this.clientForSelector(selector, "prompt").getPrompt(selector, args, options);
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.disconnect()));
  }

  private clientForSelector(selector: string, kind: McpCapabilityKind): KilnMcpClient {
    const match = /^mcp:([^:]+):(tool|resource|prompt):/.exec(selector);
    if (!match || match[2] !== kind) {
      throw new KilnMcpClientError("MCP_SELECTOR_INVALID", "unknown", "MCP capability selector must be server-qualified");
    }
    const client = this.clients.get(match[1]!);
    if (!client) {
      throw new KilnMcpClientError("MCP_CAPABILITY_NOT_FOUND", match[1]!, "MCP capability server is not registered");
    }
    return client;
  }
}

async function collectPages<T>(
  load: (cursor?: string) => Promise<unknown>,
  key: string,
  budget: DiscoveryCollectionBudget,
  serverId: string,
): Promise<CollectedMcpPage<T>> {
  const result: T[] = [];
  let cursor: string | undefined;
  let ttlMs: number | undefined;
  let cacheScope: "public" | "private" | undefined;
  let ttlEvidenceComplete = true;
  let ttlEvidenceSeen = false;
  let cacheScopeEvidenceComplete = true;
  let cacheScopeEvidenceSeen = false;
  const seenCursors = new Set<string>();
  for (let pageNumber = 1; ; pageNumber += 1) {
    if (pageNumber > MAX_DISCOVERY_PAGES) {
      throw new KilnMcpClientError(
        "MCP_REQUEST_FAILED",
        serverId,
        `MCP ${key} discovery exceeded the bounded page limit.`,
      );
    }
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) {
        throw new KilnMcpClientError(
          "MCP_REQUEST_FAILED",
          serverId,
          `MCP ${key} discovery returned a repeated pagination cursor.`,
        );
      }
      seenCursors.add(cursor);
    }
    const page = await load(cursor);
    if (!isRecord(page)) {
      throw new KilnMcpClientError(
        "MCP_REQUEST_FAILED",
        serverId,
        `MCP ${key} discovery returned a malformed page.`,
      );
    }
    const values = pageField(page, key, serverId, key);
    const pageValues = readPageValues<T>(values, serverId, key, budget.remaining);
    if (pageValues.length > MAX_DISCOVERY_CAPABILITIES || pageValues.length > budget.remaining) {
      throw new KilnMcpClientError(
        "MCP_CATALOG_LIMIT_EXCEEDED",
        serverId,
        `MCP ${key} discovery exceeded the bounded capability limit.`,
      );
    }
    budget.remaining -= pageValues.length;
    result.push(...pageValues);

    const ttl = optionalPageField(page, "ttlMs", serverId, key);
    if (ttl === undefined) {
      ttlEvidenceComplete = false;
    } else {
      const parsedTtl = finiteNonNegativeNumber(ttl);
      if (parsedTtl === undefined) {
        throw new KilnMcpClientError(
          "MCP_REQUEST_FAILED",
          serverId,
          `MCP ${key} discovery returned malformed TTL evidence.`,
        );
      }
      ttlEvidenceSeen = true;
      ttlMs = ttlMs === undefined ? parsedTtl : Math.min(ttlMs, parsedTtl);
    }

    const scope = optionalPageField(page, "cacheScope", serverId, key);
    if (scope === undefined) {
      cacheScopeEvidenceComplete = false;
    } else if (scope !== "public" && scope !== "private") {
      throw new KilnMcpClientError(
        "MCP_REQUEST_FAILED",
        serverId,
        `MCP ${key} discovery returned malformed cache-scope evidence.`,
      );
    } else {
      cacheScopeEvidenceSeen = true;
      if (cacheScope !== undefined && cacheScope !== scope) cacheScopeEvidenceComplete = false;
      cacheScope ??= scope;
    }

    const nextCursor = optionalPageField(page, "nextCursor", serverId, key);
    if (nextCursor === undefined || nextCursor === null) break;
    if (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor.length > MAX_DISCOVERY_CURSOR_LENGTH) {
      throw new KilnMcpClientError(
        "MCP_REQUEST_FAILED",
        serverId,
        `MCP ${key} discovery returned a malformed pagination cursor.`,
      );
    }
    if (nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new KilnMcpClientError(
        "MCP_REQUEST_FAILED",
        serverId,
        `MCP ${key} discovery returned a non-progressing pagination cursor.`,
      );
    }
    cursor = nextCursor;
  }
  return {
    values: result,
    ...(ttlEvidenceComplete && ttlEvidenceSeen && ttlMs !== undefined ? { ttlMs } : {}),
    ...(cacheScopeEvidenceComplete && cacheScopeEvidenceSeen && cacheScope !== undefined ? { cacheScope } : {}),
  };
}

interface CollectedMcpPage<T> {
  readonly values: T[];
  readonly ttlMs?: number;
  readonly cacheScope?: "public" | "private";
}

interface DiscoveryCollectionBudget {
  remaining: number;
}

function pageField(
  page: Record<string, unknown>,
  field: string,
  serverId: string,
  kind: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(page, field);
  if (!descriptor || !("value" in descriptor)) {
    throw new KilnMcpClientError(
      "MCP_REQUEST_FAILED",
      serverId,
      `MCP ${kind} discovery returned a malformed page.`,
    );
  }
  return descriptor.value;
}

function optionalPageField(
  page: Record<string, unknown>,
  field: string,
  serverId: string,
  kind: string,
): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(page, field);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new KilnMcpClientError(
      "MCP_REQUEST_FAILED",
      serverId,
      `MCP ${kind} discovery returned malformed ${field} evidence.`,
    );
  }
  return descriptor.value;
}

function readPageValues<T>(value: unknown, serverId: string, kind: string, remaining: number): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new KilnMcpClientError(
      "MCP_REQUEST_FAILED",
      serverId,
      `MCP ${kind} discovery returned a malformed capability page.`,
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value;
  if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(length) || length < 0) {
    throw new KilnMcpClientError(
      "MCP_REQUEST_FAILED",
      serverId,
      `MCP ${kind} discovery returned a malformed capability page.`,
    );
  }
  if (length > MAX_DISCOVERY_CAPABILITIES || length > remaining) {
    throw new KilnMcpClientError(
      "MCP_CATALOG_LIMIT_EXCEEDED",
      serverId,
      `MCP ${kind} discovery returned an oversized capability page.`,
    );
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
    throw new KilnMcpClientError(
      "MCP_REQUEST_FAILED",
      serverId,
      `MCP ${kind} discovery returned a malformed capability page.`,
    );
  }
  if (keys.length !== length + 1) {
    throw new KilnMcpClientError(
      "MCP_REQUEST_FAILED",
      serverId,
      `MCP ${kind} discovery returned a sparse capability page.`,
    );
  }
  const result: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new KilnMcpClientError(
        "MCP_REQUEST_FAILED",
        serverId,
        `MCP ${kind} discovery returned a malformed capability page.`,
      );
    }
    result.push(descriptor.value as T);
  }
  return result;
}

function settleMcpDiscoverySnapshot(
  snapshot: McpDiscoverySnapshot,
  attestation: McpDiscoverySnapshotAttestation | undefined,
): McpDiscoverySnapshot {
  const frozenSnapshot = deepFreezeMcpDiscoverySnapshot(snapshot);
  AUTHENTIC_MCP_DISCOVERY_SNAPSHOTS.set(frozenSnapshot, attestation);
  return frozenSnapshot;
}

function deepFreezeMcpDiscoverySnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(object))) {
    if ("value" in descriptor) deepFreezeMcpDiscoverySnapshot(descriptor.value, seen);
  }
  Object.freeze(object);
  return value;
}

function deriveDiscoveryFreshness(
  observedAt: string,
  pages: readonly CollectedMcpPage<unknown>[],
): McpDiscoverySnapshot["freshness"] {
  const ttlValues = pages.map((page) => page.ttlMs);
  const ttlMs = ttlValues.every((value): value is number => value !== undefined && value > 0)
    ? Math.min(...ttlValues)
    : undefined;
  const scopes = pages.map((page) => page.cacheScope).filter((scope): scope is "public" | "private" => scope !== undefined);
  const cacheScope = scopes.length === pages.length && scopes.every((scope) => scope === scopes[0]) ? scopes[0] : undefined;
  return {
    observedAt,
    ...(ttlMs !== undefined ? {
      ttlMs,
      validUntil: new Date(Date.parse(observedAt) + ttlMs).toISOString(),
    } : {}),
    ...(cacheScope !== undefined ? { cacheScope } : {}),
  };
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function withoutAnnotations(tool: McpToolDescriptor): McpToolDescriptor {
  const { annotations: _annotations, ...descriptor } = tool;
  return descriptor;
}

function parseHttpUrl(server: ResolvedMcpServer): URL {
  try {
    return new URL(server.url ?? "");
  } catch {
    throw new KilnMcpClientError(
      "MCP_CONNECTION_FAILED",
      server.id,
      `MCP server ${server.id} has an invalid Streamable HTTP URL`,
    );
  }
}

function unwrapToolResult(result: unknown, serverId: string): unknown {
  if (!result || typeof result !== "object") return result;
  const value = result as { readonly isError?: boolean; readonly content?: readonly { readonly type?: string; readonly text?: string }[] };
  if (value.isError) {
    throw new KilnMcpClientError("MCP_REQUEST_FAILED", serverId, `MCP tool execution on server ${serverId} failed`);
  }
  const content = value.content;
  if (!content) return result;
  if (content.length !== 1 || content[0]?.type !== "text") return content;
  const text = content[0].text ?? "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mcpHintTags(annotations?: Readonly<Record<string, unknown>>): readonly string[] {
  if (!annotations) return [];
  const tags: string[] = [];
  if (annotations["readOnlyHint"] === true) tags.push("mcp-hint:read-only");
  if (annotations["destructiveHint"] === true) tags.push("mcp-hint:destructive");
  if (annotations["idempotentHint"] === true) tags.push("mcp-hint:idempotent");
  if (annotations["openWorldHint"] === true) tags.push("mcp-hint:open-world");
  return tags;
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([first, second]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
