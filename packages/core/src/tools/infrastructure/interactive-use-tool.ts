import type { DevTool, DevToolAnnotations, DevToolName, ToolInput, ToolResult } from "../domain/tool.js";
import { TOOL_SCHEMAS } from "../domain/tool.js";
import {
  interactiveToolMetadata,
  type InteractiveActionMetadata,
  type InteractiveObservationMetadata,
  type ToolResourceLinkMetadata,
  type InteractiveTarget,
  type InteractiveToolName,
  type InteractiveToolOperation,
  type ToolOutputVerbosity,
} from "../domain/tool-result-metadata.js";
import type { ArtifactResourceStore } from "./artifact-resource-store.js";
import { toErrorResult } from "./tool-helpers.js";

export interface InteractiveUseProvider {
  execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult>;
}

export interface InteractiveUseToolOptions {
  readonly provider?: InteractiveUseProvider;
  readonly artifactStore?: ArtifactResourceStore;
}

export interface InteractiveUseRequest {
  readonly toolName: InteractiveToolName;
  readonly target: InteractiveTarget;
  readonly operation: InteractiveToolOperation;
  readonly sessionId?: string;
  readonly url?: string;
  readonly action?: InteractiveActionMetadata;
  readonly observationRequest?: InteractiveObservationRequest;
  readonly allowedDomains?: readonly string[];
  readonly allowedApplications?: readonly string[];
  readonly windowTitle?: string;
  readonly application?: string;
  readonly recordArtifacts?: boolean;
  readonly timeoutMs?: number;
  readonly sensitive?: boolean;
  readonly requiresApproval?: boolean;
  readonly verbosity?: ToolOutputVerbosity;
  readonly input: Record<string, unknown>;
}

export interface InteractiveObservationRequest {
  readonly includeScreenshot?: boolean;
  readonly includeDom?: boolean;
  readonly includeAccessibility?: boolean;
  readonly includeConsole?: boolean;
  readonly includeNetwork?: boolean;
}

export interface InteractiveUseProviderResult {
  readonly output?: string;
  readonly provider?: string;
  readonly sessionId?: string;
  readonly observation?: InteractiveObservationMetadata;
  readonly resourcePayload?: ToolResult["resourcePayload"];
  readonly content?: ToolResult["content"];
}

interface InteractiveUseToolDefinition<TToolName extends InteractiveToolName> {
  readonly name: TToolName;
  readonly target: InteractiveTarget;
  readonly operation: InteractiveToolOperation;
}

abstract class BaseInteractiveUseTool<TToolName extends InteractiveToolName> implements DevTool {
  readonly name: TToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: DevToolAnnotations;
  private readonly target: InteractiveTarget;
  private readonly operation: InteractiveToolOperation;
  private readonly provider?: InteractiveUseProvider;
  private readonly artifactStore?: ArtifactResourceStore;

  protected constructor(definition: InteractiveUseToolDefinition<TToolName>, options: InteractiveUseToolOptions = {}) {
    const schema = TOOL_SCHEMAS[definition.name as DevToolName];
    this.name = definition.name;
    this.description = schema.description;
    this.inputSchema = schema.inputSchema;
    this.annotations = schema.annotations;
    this.target = definition.target;
    this.operation = definition.operation;
    this.provider = options.provider;
    this.artifactStore = options.artifactStore;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const request = this.toRequest(input.input);
    if (!this.provider) {
      const label = this.target === "browser" ? "Browser use" : "Computer use";
      return toErrorResult(`${label} provider is not configured`, interactiveToolMetadata(this.name, {
        target: this.target,
        operation: this.operation,
        sessionId: request.sessionId,
        action: request.action,
        errorCode: "provider_not_configured",
        verbosity: request.verbosity,
      }));
    }

    try {
      const result = await this.provider.execute(request);
      const artifacts = this.materializeObservationArtifacts(result);
      return {
        output: result.output ?? this.defaultOutput(result),
        isError: false,
        content: mergeContent(result.content, artifacts.content),
        resourcePayload: result.resourcePayload,
        metadata: interactiveToolMetadata(this.name, {
        target: this.target,
        operation: this.operation,
        provider: result.provider,
        sessionId: result.sessionId ?? request.sessionId,
        action: request.action,
        observation: artifacts.observation,
        allowedDomains: request.allowedDomains,
        allowedApplications: request.allowedApplications,
        requiresApproval: request.requiresApproval,
        sensitive: request.sensitive,
        timeoutMs: request.timeoutMs,
        verbosity: request.verbosity,
        resourceLinks: artifacts.resourceLinks,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toErrorResult(message, interactiveToolMetadata(this.name, {
        target: this.target,
        operation: this.operation,
        sessionId: request.sessionId,
        action: request.action,
        errorCode: "provider_error",
        verbosity: request.verbosity,
      }));
    }
  }

  private toRequest(input: Record<string, unknown>): InteractiveUseRequest {
    const action = this.actionFromInput(input);
    return {
      toolName: this.name,
      target: this.target,
      operation: this.operation,
      sessionId: readString(input.sessionId),
      url: readString(input.url),
      action,
      observationRequest: observationRequestFromInput(input),
      allowedDomains: readStringArray(input.allowedDomains),
      allowedApplications: readStringArray(input.allowedApplications),
      windowTitle: readString(input.windowTitle),
      application: readString(input.application),
      recordArtifacts: readBoolean(input.recordArtifacts),
      timeoutMs: readNumber(input.timeout),
      sensitive: readBoolean(input.sensitive),
      requiresApproval: readBoolean(input.requiresApproval) || readBoolean(input.sensitive) || undefined,
      verbosity: readVerbosity(input.verbosity),
      input,
    };
  }

  private actionFromInput(input: Record<string, unknown>): InteractiveActionMetadata | undefined {
    if (this.operation === "observe") {
      return undefined;
    }
    const target = readTarget(input.target);
    return {
      type: this.operation,
      url: readString(input.url),
      x: target.x,
      y: target.y,
      selector: target.selector,
      ref: target.ref,
      button: readButton(input.button),
      keys: readStringArray(input.keys),
      direction: readDirection(input.direction),
      deltaX: readNumber(input.deltaX),
      deltaY: readNumber(input.deltaY),
      textLength: typeof input.text === "string" ? input.text.length : undefined,
      sensitive: readBoolean(input.sensitive),
    };
  }

  private defaultOutput(result: InteractiveUseProviderResult): string {
    if (result.observation?.url) {
      return `${this.operation}: ${result.observation.url}`;
    }
    if (result.observation?.windowTitle) {
      if (this.operation === "close_application" && result.observation.closeMethod) {
        return `${this.operation}: ${result.observation.windowTitle} (${result.observation.closeMethod})`;
      }
      return `${this.operation}: ${result.observation.windowTitle}`;
    }
    return `${this.operation} completed`;
  }

  private materializeObservationArtifacts(
    result: InteractiveUseProviderResult,
  ): {
    readonly observation?: InteractiveObservationMetadata;
    readonly resourceLinks?: readonly ToolResourceLinkMetadata[];
    readonly content?: ToolResult["content"];
  } {
    const observation = result.observation;
    if (!observation) {
      return {};
    }
    const screenshotDataUrl = observation.screenshotDataUrl;
    if (!screenshotDataUrl) {
      return { observation };
    }
    const parsed = parseDataUrl(screenshotDataUrl);
    const existingUri = observation.screenshotUri;
    const artifact = !existingUri && parsed && this.artifactStore
      ? this.artifactStore.put({
          namespace: "interactive-screenshots",
          title: `${this.name} screenshot`,
          mimeType: parsed.mimeType,
          content: { type: "blob", blob: parsed.base64 },
          producer: { kind: "tool", name: this.name },
          retention: { scope: "session", maxArtifacts: 50 },
        })
      : undefined;
    const screenshotUri = existingUri
      ?? (artifact ? `kiln://artifacts/${artifact.namespace}/${artifact.id}/content` : undefined);
    const { screenshotDataUrl: _screenshotDataUrl, ...observationWithoutDataUrl } = observation;
    const nextObservation = screenshotUri
      ? { ...observationWithoutDataUrl, screenshotUri }
      : observation;
    const mimeType = parsed?.mimeType ?? artifact?.mimeType;
    const size = artifact?.size;
    const title = `${this.name} screenshot`;
    const resourceLink: ToolResourceLinkMetadata | undefined = screenshotUri
      ? {
          uri: screenshotUri,
          title,
          ...(mimeType ? { mimeType } : {}),
          ...(size !== undefined ? { size } : {}),
          relation: "snapshot",
        }
      : undefined;
    const content = resourceLink
      ? [{
          type: "resource_link" as const,
          uri: resourceLink.uri,
          name: resourceLink.title ?? title,
          ...(resourceLink.mimeType ? { mimeType: resourceLink.mimeType } : {}),
          ...(resourceLink.size !== undefined ? { size: resourceLink.size } : {}),
          annotations: {
            audience: ["assistant"],
            priority: 0.8,
          },
        }]
      : undefined;
    if (screenshotUri) {
      return {
        observation: nextObservation,
        resourceLinks: [resourceLink!],
        content,
      };
    }
    return { observation: nextObservation };
  }
}

function parseDataUrl(value: string): { readonly mimeType: string; readonly base64: string } | undefined {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u.exec(value);
  if (!match) {
    return undefined;
  }
  return {
    mimeType: match[1]!,
    base64: match[2]!,
  };
}

function mergeContent(
  left: ToolResult["content"] | undefined,
  right: ToolResult["content"] | undefined,
): ToolResult["content"] | undefined {
  if (!left?.length) return right;
  if (!right?.length) return left;
  return [...left, ...right];
}

export class BrowserSessionStartTool extends BaseInteractiveUseTool<"browser_session_start"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_session_start", target: "browser", operation: "session_start" }, options);
  }
}

export class BrowserNavigateTool extends BaseInteractiveUseTool<"browser_navigate"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_navigate", target: "browser", operation: "navigate" }, options);
  }
}

export class BrowserObserveTool extends BaseInteractiveUseTool<"browser_observe"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_observe", target: "browser", operation: "observe" }, options);
  }
}

export class BrowserClickTool extends BaseInteractiveUseTool<"browser_click"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_click", target: "browser", operation: "click" }, options);
  }
}

export class BrowserTypeTool extends BaseInteractiveUseTool<"browser_type"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_type", target: "browser", operation: "type" }, options);
  }
}

export class BrowserKeypressTool extends BaseInteractiveUseTool<"browser_keypress"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_keypress", target: "browser", operation: "keypress" }, options);
  }
}

export class BrowserScrollTool extends BaseInteractiveUseTool<"browser_scroll"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_scroll", target: "browser", operation: "scroll" }, options);
  }
}

export class BrowserSessionStopTool extends BaseInteractiveUseTool<"browser_session_stop"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "browser_session_stop", target: "browser", operation: "session_stop" }, options);
  }
}

export class ComputerObserveTool extends BaseInteractiveUseTool<"computer_observe"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_observe", target: "computer", operation: "observe" }, options);
  }
}

export class ComputerClickTool extends BaseInteractiveUseTool<"computer_click"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_click", target: "computer", operation: "click" }, options);
  }
}

export class ComputerTypeTool extends BaseInteractiveUseTool<"computer_type"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_type", target: "computer", operation: "type" }, options);
  }
}

export class ComputerKeypressTool extends BaseInteractiveUseTool<"computer_keypress"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_keypress", target: "computer", operation: "keypress" }, options);
  }
}

export class ComputerOpenApplicationTool extends BaseInteractiveUseTool<"computer_open_application"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_open_application", target: "computer", operation: "open_application" }, options);
  }
}

export class ComputerFocusApplicationTool extends BaseInteractiveUseTool<"computer_focus_application"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_focus_application", target: "computer", operation: "focus_application" }, options);
  }
}

export class ComputerMinimizeApplicationTool extends BaseInteractiveUseTool<"computer_minimize_application"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_minimize_application", target: "computer", operation: "minimize_application" }, options);
  }
}

export class ComputerCloseApplicationTool extends BaseInteractiveUseTool<"computer_close_application"> {
  constructor(options?: InteractiveUseToolOptions) {
    super({ name: "computer_close_application", target: "computer", operation: "close_application" }, options);
  }
}

function observationRequestFromInput(input: Record<string, unknown>): InteractiveObservationRequest {
  return {
    includeScreenshot: readBoolean(input.includeScreenshot),
    includeDom: readBoolean(input.includeDom),
    includeAccessibility: readBoolean(input.includeAccessibility),
    includeConsole: readBoolean(input.includeConsole),
    includeNetwork: readBoolean(input.includeNetwork),
  };
}

function readTarget(value: unknown): { ref?: string; selector?: string; x?: number; y?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ref: readString(record.ref),
    selector: readString(record.selector),
    x: readNumber(record.x),
    y: readNumber(record.y),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readVerbosity(value: unknown): ToolOutputVerbosity | undefined {
  return value === "raw" || value === "structured" || value === "summary" ? value : undefined;
}

function readButton(value: unknown): "left" | "middle" | "right" | undefined {
  return value === "left" || value === "middle" || value === "right" ? value : undefined;
}

function readDirection(value: unknown): "up" | "down" | "left" | "right" | undefined {
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : undefined;
}
