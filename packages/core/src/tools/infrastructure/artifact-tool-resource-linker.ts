import type { ToolResult, ToolResultContentPart } from "../domain/tool.js";
import type { ToolResourceLinker, ToolResourceLinkRequest } from "../domain/tool-resource-links.js";
import type {
  ToolResourceLinkMetadata,
  ToolResultMetadata,
} from "../domain/tool-result-metadata.js";
import type {
  ArtifactResourceStore,
  ArtifactRetentionPolicy,
} from "./artifact-resource-store.js";

const DEFAULT_MIN_OUTPUT_BYTES = 8 * 1024;
const DEFAULT_RETENTION: ArtifactRetentionPolicy = {
  scope: "session",
  maxArtifacts: 100,
};
const DEFAULT_LINKED_TOOLS = new Set([
  "read_many",
  "tree",
  "monitor_read",
  "monitor_list",
  "web_fetch",
  "web_extract",
  "web_search",
  "code_intelligence",
  "browser_session_stop",
]);

export interface ArtifactToolResourceLinkerOptions {
  readonly store: ArtifactResourceStore;
  readonly minOutputBytes?: number;
  readonly retention?: ArtifactRetentionPolicy;
  readonly linkedTools?: readonly string[];
}

export class ArtifactToolResourceLinker implements ToolResourceLinker {
  private readonly store: ArtifactResourceStore;
  private readonly minOutputBytes: number;
  private readonly retention: ArtifactRetentionPolicy;
  private readonly linkedTools: ReadonlySet<string>;

  constructor(options: ArtifactToolResourceLinkerOptions) {
    this.store = options.store;
    this.minOutputBytes = clampPositive(options.minOutputBytes, DEFAULT_MIN_OUTPUT_BYTES);
    this.retention = options.retention ?? DEFAULT_RETENTION;
    this.linkedTools = new Set(options.linkedTools ?? DEFAULT_LINKED_TOOLS);
  }

  link(request: ToolResourceLinkRequest): ToolResult {
    if (!this.shouldLink(request.toolName, request.result)) {
      return stripResourcePayload(request.result);
    }

    const payload = request.result.resourcePayload ?? {
      text: request.result.output,
      mimeType: "text/plain",
    };
    const title = payload.title ?? `${request.toolName} full output`;
    let artifact;
    try {
      artifact = this.store.put({
        namespace: "tool-results",
        title,
        mimeType: payload.mimeType,
        content: { type: "text", text: payload.text },
        producer: { kind: "tool", name: request.toolName },
        retention: this.retention,
      });
    } catch {
      return request.result;
    }

    const uri = `kiln://artifacts/tool-results/${artifact.id}/content`;
    const metadataLink: ToolResourceLinkMetadata = {
      uri,
      title,
      mimeType: artifact.mimeType,
      size: artifact.size,
      relation: "full_output",
    };
    const contentLink: ToolResultContentPart = {
      type: "resource_link",
      uri,
      name: title,
      mimeType: artifact.mimeType,
      size: artifact.size,
      annotations: {
        audience: ["assistant"],
        priority: 0.8,
      },
    };

    const visibleResult = stripResourcePayload(request.result);
    return {
      ...visibleResult,
      metadata: this.appendMetadataLink(visibleResult.metadata, metadataLink),
      content: [...(visibleResult.content ?? []), contentLink],
    };
  }

  private shouldLink(toolName: string, result: ToolResult): boolean {
    if (result.isError || !result.metadata || !this.linkedTools.has(toolName)) {
      return false;
    }
    if (toolName === "browser_session_stop" && result.resourcePayload) {
      return true;
    }
    return Buffer.byteLength(result.output, "utf8") >= this.minOutputBytes
      || hasTruncationMetadata(result.metadata);
  }

  private appendMetadataLink(
    metadata: ToolResultMetadata | undefined,
    link: ToolResourceLinkMetadata,
  ): ToolResultMetadata | undefined {
    if (!metadata) {
      return undefined;
    }
    return {
      ...metadata,
      resourceLinks: [...(metadata.resourceLinks ?? []), link],
    };
  }
}

function stripResourcePayload(result: ToolResult): ToolResult {
  const { resourcePayload: _resourcePayload, ...visibleResult } = result;
  return visibleResult;
}

function hasTruncationMetadata(metadata: ToolResultMetadata): boolean {
  return "truncated" in metadata && metadata.truncated === true;
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}
