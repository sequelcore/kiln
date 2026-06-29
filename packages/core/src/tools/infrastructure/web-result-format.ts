import type { ToolOutputVerbosity, WebSourceMetadata } from "../domain/tool-result-metadata.js";
import { pluralize } from "./output-verbosity.js";

const SUMMARY_SOURCE_LIMIT = 8;
const SUMMARY_TITLE_LIMIT = 120;
const SUMMARY_SNIPPET_LIMIT = 180;

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
    const visibleSources = output.sources.slice(0, SUMMARY_SOURCE_LIMIT);
    return [
      `${output.sources.length} ${pluralize(output.sources.length, "source")} for ${output.query}`,
      ...visibleSources.map(formatWebSearchSourceSummary),
      output.sources.length > visibleSources.length
        ? `${output.sources.length - visibleSources.length} more ${pluralize(output.sources.length - visibleSources.length, "source")} omitted from summary`
        : undefined,
    ].filter(Boolean).join("\n");
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
    const visiblePages = output.pages.slice(0, SUMMARY_SOURCE_LIMIT);
    return [
      `${output.pages.length} extracted ${pluralize(output.pages.length, "page")}`,
      `${characterCount} characters`,
      truncatedCount > 0 ? `${truncatedCount} truncated` : "not truncated",
      "Source pages:",
      ...visiblePages.map(formatWebExtractPageSummary),
      output.pages.length > visiblePages.length
        ? `${output.pages.length - visiblePages.length} more ${pluralize(output.pages.length - visiblePages.length, "page")} omitted from summary`
        : undefined,
    ].filter(Boolean).join("\n");
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

function formatWebSearchSourceSummary(source: WebSourceMetadata): string {
  return [
    source.rank ? `${source.rank}.` : "-",
    truncateText(source.title ?? source.url, SUMMARY_TITLE_LIMIT),
    source.url,
    source.snippet ? truncateText(source.snippet, SUMMARY_SNIPPET_LIMIT) : undefined,
  ].filter(Boolean).join(" ");
}

function formatWebExtractPageSummary(page: WebExtractOutputPage): string {
  return [
    page.title ? `${truncateText(page.title, SUMMARY_TITLE_LIMIT)}: ${page.url}` : page.url,
    page.truncated ? "truncated" : undefined,
  ].filter(Boolean).join(" ");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
