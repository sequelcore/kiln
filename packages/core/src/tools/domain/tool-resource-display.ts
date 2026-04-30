import type { ToolResult } from "./tool.js";
import type { ToolResourceLinkMetadata, ToolResultMetadata } from "./tool-result-metadata.js";
import type { ToolResourceDescriptor } from "./tool-resource-registry.js";

export interface ToolResourceDisplayDescriptor {
  readonly uri: string;
  readonly name?: string;
  readonly title?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: ToolResourceLinkMetadata["relation"];
  readonly truncated?: boolean;
}

export function projectToolResourceDescriptor(
  descriptor: ToolResourceDescriptor,
): ToolResourceDisplayDescriptor {
  return compactResourceDisplay({
    uri: descriptor.uri,
    name: descriptor.name,
    title: descriptor.title,
    mimeType: descriptor.mimeType,
    size: descriptor.size,
    truncated: descriptor._meta?.["truncated"] === true,
  });
}

export function projectToolResourceLink(
  link: ToolResourceLinkMetadata,
  truncated = false,
): ToolResourceDisplayDescriptor {
  return compactResourceDisplay({
    uri: link.uri,
    title: link.title,
    mimeType: link.mimeType,
    size: link.size,
    relation: link.relation,
    truncated,
  });
}

export function projectToolResultResourceLinks(
  result: ToolResult,
): readonly ToolResourceDisplayDescriptor[] {
  const links = result.metadata?.resourceLinks ?? [];
  if (links.length === 0) {
    return [];
  }
  const truncated = hasTruncationMetadata(result.metadata);
  return links.map((link) => projectToolResourceLink(link, truncated));
}

function compactResourceDisplay(
  descriptor: ToolResourceDisplayDescriptor,
): ToolResourceDisplayDescriptor {
  return {
    uri: descriptor.uri,
    ...(descriptor.name ? { name: descriptor.name } : {}),
    ...(descriptor.title ? { title: descriptor.title } : {}),
    ...(descriptor.mimeType ? { mimeType: descriptor.mimeType } : {}),
    ...(descriptor.size !== undefined ? { size: descriptor.size } : {}),
    ...(descriptor.relation ? { relation: descriptor.relation } : {}),
    ...(descriptor.truncated ? { truncated: true } : {}),
  };
}

function hasTruncationMetadata(metadata: ToolResultMetadata | undefined): boolean {
  return !!metadata && "truncated" in metadata && metadata.truncated === true;
}
