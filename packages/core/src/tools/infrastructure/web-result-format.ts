import type { ToolOutputVerbosity, WebSourceMetadata } from "../domain/tool-result-metadata.js";
import { pluralize } from "./output-verbosity.js";

export interface WebFetchOutput {
  readonly url: string;
  readonly text: string;
  readonly status?: number;
  readonly contentType?: string;
  readonly truncated: boolean;
}

export interface WebSearchOutput {
  readonly query: string;
  readonly sources: readonly WebSourceMetadata[];
}

export interface WebExtractOutputPage {
  readonly url: string;
  readonly title?: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface WebExtractOutput {
  readonly pages: readonly WebExtractOutputPage[];
}

export function formatWebFetchOutput(
  output: WebFetchOutput,
  verbosity: ToolOutputVerbosity,
): string {
  if (verbosity === "structured") {
    return JSON.stringify(output, null, 2);
  }

  if (verbosity === "summary") {
    return [
      `Fetched ${output.url}`,
      output.contentType ? `content type ${output.contentType}` : undefined,
      `${output.text.length} characters`,
      output.truncated ? "truncated" : "not truncated",
    ].filter(Boolean).join("; ");
  }

  return output.text;
}

export function formatWebSearchOutput(
  output: WebSearchOutput,
  verbosity: ToolOutputVerbosity,
): string {
  if (verbosity === "structured") {
    return JSON.stringify(output, null, 2);
  }

  if (verbosity === "summary") {
    return `${output.sources.length} ${pluralize(output.sources.length, "source")} for ${output.query}`;
  }

  return output.sources
    .map((source) => [
      source.rank ? `${source.rank}.` : "-",
      source.title ?? source.url,
      source.url,
      source.snippet,
    ].filter(Boolean).join(" "))
    .join("\n");
}

export function formatWebExtractOutput(
  output: WebExtractOutput,
  verbosity: ToolOutputVerbosity,
): string {
  if (verbosity === "structured") {
    return JSON.stringify(output, null, 2);
  }

  const characterCount = output.pages.reduce((sum, page) => sum + page.text.length, 0);
  const truncatedCount = output.pages.filter((page) => page.truncated).length;
  if (verbosity === "summary") {
    return [
      `${output.pages.length} extracted ${pluralize(output.pages.length, "page")}`,
      `${characterCount} characters`,
      truncatedCount > 0 ? `${truncatedCount} truncated` : "not truncated",
    ].join("; ");
  }

  return output.pages
    .map((page) => [
      `Source: ${page.url}`,
      page.title ? `Title: ${page.title}` : undefined,
      "",
      page.text,
    ].filter((line): line is string => line !== undefined).join("\n"))
    .join("\n\n---\n\n");
}
