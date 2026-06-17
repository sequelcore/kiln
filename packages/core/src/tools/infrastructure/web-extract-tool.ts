import type { SandboxPolicy } from "../../sandbox/policies.js";
import {
  webToolMetadata,
  type ToolOutputVerbosity,
  type WebExtractFormat,
  type WebExtractPageMetadata,
  type WebToolErrorCode,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import {
  optionalNumber,
  toErrorResult,
  toSuccessResult,
} from "./tool-helpers.js";
import { validateWebAccess } from "./web-policy.js";
import { formatWebExtractOutput, type WebExtractOutputPage } from "./web-result-format.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BYTES = 200_000;
const MAX_BYTES = 1_000_000;
const MAX_URLS = 10;

export interface WebExtractProviderRequest {
  readonly urls: readonly string[];
  readonly format: WebExtractFormat;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface WebExtractPage {
  readonly url: string;
  readonly normalizedUrl?: string;
  readonly title?: string;
  readonly contentType?: string;
  readonly status?: number;
  readonly text: string;
  readonly bytesRead?: number;
  readonly truncated?: boolean;
}

export interface WebExtractProviderResponse {
  readonly provider?: string;
  readonly retrievedAt?: string;
  readonly pages: readonly WebExtractPage[];
}

export type WebExtractProvider = (request: WebExtractProviderRequest) => Promise<WebExtractProviderResponse>;

export interface WebExtractToolOptions {
  readonly extractProvider?: WebExtractProvider;
  readonly networkPolicy?: SandboxPolicy;
}

export class WebExtractTool implements DevTool {
  readonly name = "web_extract";
  readonly description = TOOL_SCHEMAS.web_extract.description;
  readonly inputSchema = TOOL_SCHEMAS.web_extract.inputSchema;

  private readonly extractProvider?: WebExtractProvider;
  private readonly networkPolicy?: SandboxPolicy;

  constructor(options: WebExtractToolOptions = {}) {
    this.extractProvider = options.extractProvider;
    this.networkPolicy = options.networkPolicy;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }
    const urlsInput = parseUrls(input);
    if (!urlsInput.ok) {
      return this.error([], urlsInput.message, "invalid_input", verbosityInput.value);
    }
    const formatInput = parseFormat(input);
    if (!formatInput.ok) {
      return this.error(urlsInput.urls, formatInput.message, "invalid_input", verbosityInput.value);
    }
    const timeoutInput = parseBoundedNumber(input, "timeout", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    if (!timeoutInput.ok) {
      return this.error(urlsInput.urls, timeoutInput.message, "invalid_input", verbosityInput.value);
    }
    const maxBytesInput = parseBoundedNumber(input, "maxBytes", DEFAULT_MAX_BYTES, MAX_BYTES);
    if (!maxBytesInput.ok) {
      return this.error(urlsInput.urls, maxBytesInput.message, "invalid_input", verbosityInput.value);
    }

    const normalizedUrls: string[] = [];
    for (const url of urlsInput.urls) {
      const access = validateWebAccess({ url, sandbox, policy: this.networkPolicy });
      if (!access.ok) {
        return this.error(urlsInput.urls, access.message, access.errorCode, verbosityInput.value);
      }
      normalizedUrls.push(access.url);
    }

    if (!this.extractProvider) {
      return this.error(
        urlsInput.urls,
        "Web extract provider is not configured",
        "provider_not_configured",
        verbosityInput.value,
      );
    }

    try {
      const response = await this.extractProvider({
        urls: normalizedUrls,
        format: formatInput.value,
        timeoutMs: timeoutInput.value,
        maxBytes: maxBytesInput.value,
      });
      const pages = normalizePages(response.pages, maxBytesInput.value);
      if (pages.length === 0) {
        return toErrorResult(
          "Web extract provider returned no extractable pages for the requested URLs",
          webToolMetadata("web_extract", {
            operation: "extract",
            provider: response.provider,
            urls: urlsInput.urls,
            format: formatInput.value,
            extractCount: 0,
            retrievedAt: response.retrievedAt ?? new Date().toISOString(),
            pages: [],
            errorCode: "empty_extraction",
            verbosity: verbosityInput.value,
          }),
        );
      }
      const metadataPages = pages.map((page): WebExtractPageMetadata => ({
        url: page.url,
        ...(page.normalizedUrl ? { normalizedUrl: page.normalizedUrl } : {}),
        ...(page.title ? { title: page.title } : {}),
        ...(page.contentType ? { contentType: page.contentType } : {}),
        ...(page.status !== undefined ? { status: page.status } : {}),
        ...(page.bytesRead !== undefined ? { bytesRead: page.bytesRead } : {}),
        truncated: page.truncated,
      }));
      const outputPages: WebExtractOutputPage[] = pages.map((page) => ({
        url: page.normalizedUrl ?? page.url,
        ...(page.title ? { title: page.title } : {}),
        text: page.text,
        truncated: page.truncated,
      }));
      const metadata = webToolMetadata("web_extract", {
        operation: "extract",
        provider: response.provider,
        urls: urlsInput.urls,
        format: formatInput.value,
        extractCount: pages.length,
        retrievedAt: response.retrievedAt ?? new Date().toISOString(),
        pages: metadataPages,
        bytesRead: pages.reduce((sum, page) => sum + (page.bytesRead ?? Buffer.byteLength(page.text, "utf8")), 0),
        truncated: pages.some((page) => page.truncated),
        verbosity: verbosityInput.value,
      });
      const output = { pages: outputPages };
      return {
        ...toSuccessResult(formatWebExtractOutput(output, verbosityInput.value), metadata),
        resourcePayload: {
          text: formatWebExtractOutput(output, "raw"),
          mimeType: formatInput.value === "markdown" ? "text/markdown" : "text/plain",
          title: "web_extract full output",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(urlsInput.urls, message, classifyProviderError(message), verbosityInput.value);
    }
  }

  private error(
    urls: readonly string[],
    message: string,
    errorCode: WebToolErrorCode,
    verbosity: ToolOutputVerbosity,
  ): ToolResult {
    return toErrorResult(message, webToolMetadata("web_extract", {
      operation: "extract",
      urls,
      errorCode,
      verbosity,
    }));
  }
}

function parseUrls(input: ToolInput): { ok: true; urls: readonly string[] } | { ok: false; message: string } {
  const value = input.input["urls"];
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: "Invalid input: \"urls\" must be a non-empty array" };
  }
  if (value.length > MAX_URLS) {
    return { ok: false, message: `Invalid input: "urls" must include at most ${MAX_URLS} URLs` };
  }
  const urls: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return { ok: false, message: "Invalid input: \"urls\" must contain only non-empty strings" };
    }
    urls.push(item.trim());
  }
  return { ok: true, urls };
}

function parseFormat(input: ToolInput): { ok: true; value: WebExtractFormat } | { ok: false; message: string } {
  const value = input.input["format"];
  if (value === undefined) {
    return { ok: true, value: "markdown" };
  }
  if (value === "text" || value === "markdown") {
    return { ok: true, value };
  }
  return { ok: false, message: "Invalid input: \"format\" must be text or markdown" };
}

function parseBoundedNumber(
  input: ToolInput,
  key: string,
  defaultValue: number,
  maxValue: number,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = optionalNumber(input, key);
  if (value === undefined) {
    if (input.input[key] !== undefined) {
      return { ok: false, message: `Invalid input: "${key}" must be a finite number` };
    }
    return { ok: true, value: defaultValue };
  }
  if (value <= 0) {
    return { ok: false, message: `Invalid input: "${key}" must be > 0` };
  }
  return { ok: true, value: Math.min(Math.trunc(value), maxValue) };
}

function normalizePages(
  pages: readonly WebExtractPage[],
  maxBytes: number,
): readonly (WebExtractPage & { readonly truncated: boolean })[] {
  return pages.map((page) => {
    const clipped = clipToBytes(page.text, maxBytes);
    const text = sanitizeExtractedText(clipped.text);
    const bytesRead = page.bytesRead ?? Buffer.byteLength(page.text, "utf8");
    return {
      url: page.url,
      ...(page.normalizedUrl ? { normalizedUrl: page.normalizedUrl } : {}),
      ...(page.title ? { title: sanitizeExtractedText(page.title) } : {}),
      ...(page.contentType ? { contentType: page.contentType } : {}),
      ...(page.status !== undefined ? { status: page.status } : {}),
      text,
      bytesRead,
      truncated: clipped.truncated || page.truncated === true || bytesRead > maxBytes,
    };
  });
}

function sanitizeExtractedText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clipToBytes(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }
  return { text: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function classifyProviderError(message: string): WebToolErrorCode {
  if (/abort|timeout/i.test(message)) {
    return "timeout";
  }
  if (/429|rate/i.test(message)) {
    return "too_many_requests";
  }
  return "provider_unreachable";
}
