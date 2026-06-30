export interface ToolResultResourceLinkPresentation {
  readonly uri: string;
  readonly title?: string;
  readonly label?: string;
  readonly sequence?: number;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
}

export interface ParsedOperatorToolResultEnvelope {
  readonly output?: string;
  readonly isError?: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly presentationIntent?: unknown;
  readonly resourceLinks: readonly ToolResultResourceLinkPresentation[];
}

export interface OperatorToolResultPayload extends Readonly<Record<string, unknown>> {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: string;
  readonly outputSummary: string;
  readonly metadata?: Record<string, unknown>;
  readonly resourceLinks?: readonly ToolResultResourceLinkPresentation[];
  readonly toolUsage?: unknown;
  readonly status: {
    readonly state: "failed" | "succeeded";
  };
}

export function parseOperatorToolResultEnvelope(
  value: string | null | undefined,
): ParsedOperatorToolResultEnvelope | null {
  if (!value) return null;
  let output: string | undefined;
  let isError: boolean | undefined;
  let metadata: Record<string, unknown> | undefined;
  let presentationIntent: unknown;
  let resourceLinks: readonly ToolResultResourceLinkPresentation[] = [];
  let current: string | null = value;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const parsed = parseJsonRecord(current);
    if (!parsed) {
      output = current;
      break;
    }
    const result = asRecord(parsed.result) ?? parsed;
    const nextMetadata = asRecord(result.metadata);
    if (nextMetadata) {
      metadata = {
        ...(metadata ?? {}),
        ...nextMetadata,
      };
      if ("presentationIntent" in nextMetadata) {
        presentationIntent = nextMetadata.presentationIntent;
      }
      const links = parseOperatorToolResultResourceLinks(nextMetadata.resourceLinks);
      if (links.length > 0) {
        resourceLinks = links;
      }
    }
    if ("presentationIntent" in result) {
      presentationIntent = result.presentationIntent;
    }
    const directLinks = parseOperatorToolResultResourceLinks(result.resourceLinks);
    if (directLinks.length > 0) {
      resourceLinks = directLinks;
    }
    if (typeof result.isError === "boolean") {
      isError = result.isError;
    }
    const nextOutput = readString(result.output);
    if (!nextOutput) {
      break;
    }
    const nested = parseJsonRecord(nextOutput);
    if (!nested || (!("output" in nested) && !("result" in nested) && !("metadata" in nested))) {
      output = nextOutput;
      break;
    }
    current = nextOutput;
  }
  return {
    ...(output ? { output } : {}),
    ...(isError !== undefined ? { isError } : {}),
    ...(metadata ? { metadata } : {}),
    ...(presentationIntent !== undefined ? { presentationIntent } : {}),
    resourceLinks,
  };
}

export function parseOperatorToolResultResourceLinks(
  value: unknown,
): readonly ToolResultResourceLinkPresentation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const uri = readString(record?.uri);
      if (!uri) return null;
      const sequence = readNumber(record?.sequence);
      const size = readNumber(record?.size);
      return {
        uri,
        ...(readString(record?.title) ? { title: readString(record?.title)! } : {}),
        ...(readString(record?.label) ? { label: readString(record?.label)! } : {}),
        ...(sequence !== null ? { sequence } : {}),
        ...(readString(record?.mimeType) ? { mimeType: readString(record?.mimeType)! } : {}),
        ...(size !== null ? { size } : {}),
        ...(readString(record?.relation) ? { relation: readString(record?.relation)! } : {}),
      } satisfies ToolResultResourceLinkPresentation;
    })
    .filter((item): item is ToolResultResourceLinkPresentation => item !== null);
}

export function buildOperatorToolResultPayload(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output?: string;
  readonly outputSummary?: string;
  readonly isError?: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly resourceLinks?: readonly ToolResultResourceLinkPresentation[];
  readonly toolUsage?: unknown;
}): OperatorToolResultPayload {
  const envelope = parseOperatorToolResultEnvelope(input.output);
  const summaryEnvelope = parseOperatorToolResultEnvelope(input.outputSummary);
  const output = envelope?.output ?? input.output ?? "";
  const outputSummary = summaryEnvelope?.output ?? input.outputSummary ?? output.slice(0, 200);
  const metadata = envelope?.metadata || input.metadata
    ? {
        ...(envelope?.metadata ?? {}),
        ...(input.metadata ?? {}),
      }
    : undefined;
  const resourceLinks = input.resourceLinks ?? envelope?.resourceLinks ?? [];
  const isError = input.isError === true || envelope?.isError === true;
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    output,
    outputSummary,
    ...(metadata ? { metadata } : {}),
    ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
    ...(input.toolUsage !== undefined ? { toolUsage: input.toolUsage } : {}),
    status: {
      state: isError ? "failed" : "succeeded",
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
