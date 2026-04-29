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
