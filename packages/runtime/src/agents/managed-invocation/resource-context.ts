import type {
  ToolCall,
  ToolResult,
} from "@kilnai/core";
import {
  DefaultContextGovernor,
  renderProjectedContext,
} from "@kilnai/core";
import type { RuntimeSession } from "../../session/runtime-session.js";
import type {
  GovernedRuntimeContext,
  RuntimeBuiltinToolExecutor,
} from "../../session/runtime-session-orchestrator.types.js";

export interface ManagedInvocationResourceReaderInput {
  readonly uri: string;
  readonly toolCall: ToolCall;
  readonly abortSignal: AbortSignal;
}

export type ManagedInvocationResourceReader = (
  input: ManagedInvocationResourceReaderInput,
) => Promise<unknown>;

export interface BuildManagedInvocationResourceContextInput {
  readonly resourceUris: readonly string[] | undefined;
  readonly invocationId: string;
  readonly abortSignal: AbortSignal;
  readonly resourceReader?: ManagedInvocationResourceReader;
}

export async function buildManagedInvocationResourceContext(
  input: BuildManagedInvocationResourceContextInput,
): Promise<GovernedRuntimeContext | undefined> {
  const { resourceUris } = input;
  if (!resourceUris || resourceUris.length === 0) {
    return undefined;
  }
  const resources = await hydrateManagedResourceContext({
    ...input,
    resourceUris,
  });
  const projected = new DefaultContextGovernor<undefined, "artifact", "balanced">().project({
    artifacts: [{
      kind: "artifact",
      source: "managed-invocation:resource-uris",
      required: true,
      score: 1,
      content: resources,
    }],
  });
  const audit = projected.auditTrail?.[projected.auditTrail.length - 1];
  return {
    content: renderProjectedContext(projected),
    ...(audit ? { audit } : {}),
  };
}

export function createManagedInvocationRuntimeResourceReader(input: {
  readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly session: RuntimeSession;
}): ManagedInvocationResourceReader | undefined {
  const resourceRead = input.builtinTools.get("resource_read");
  if (!resourceRead) {
    return undefined;
  }
  return ({ uri, toolCall, abortSignal }) =>
    resourceRead({ uri }, {
      session: input.session,
      toolCall,
      abortSignal,
    });
}

async function hydrateManagedResourceContext(
  input: BuildManagedInvocationResourceContextInput & {
    readonly resourceUris: readonly string[];
  },
): Promise<string> {
  if (!input.resourceReader) {
    return `Admitted resources:\n${input.resourceUris.join("\n")}`;
  }
  const blocks: string[] = [];
  for (const [index, uri] of input.resourceUris.entries()) {
    const toolCall: ToolCall = {
      id: `${input.invocationId}:resource-context:${index + 1}`,
      name: "resource_read",
      input: { uri },
    };
    const result = await input.resourceReader({
      uri,
      toolCall,
      abortSignal: input.abortSignal,
    });
    blocks.push(formatHydratedManagedResource(uri, result));
  }
  return `Admitted resource contents:\n\n${blocks.join("\n\n")}`;
}

function formatHydratedManagedResource(uri: string, result: unknown): string {
  const toolResult = asToolResult(result);
  if (!toolResult) {
    return [`Resource URI: ${uri}`, "Read result:", stringifyUnknown(result)].join("\n");
  }
  if (toolResult.isError) {
    return [
      `Resource URI: ${uri}`,
      "Read status: failed",
      toolResult.output,
    ].join("\n");
  }
  return [
    `Resource URI: ${uri}`,
    "Read status: succeeded",
    toolResult.output,
  ].join("\n");
}

function asToolResult(value: unknown): ToolResult | undefined {
  return value
    && typeof value === "object"
    && typeof (value as ToolResult).output === "string"
    && typeof (value as ToolResult).isError === "boolean"
    ? value as ToolResult
    : undefined;
}

function stringifyUnknown(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}
