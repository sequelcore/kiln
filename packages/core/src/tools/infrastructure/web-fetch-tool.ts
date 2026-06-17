import type { SandboxPolicy } from "../../sandbox/policies.js";
import {
  webToolMetadata,
  type ToolOutputVerbosity,
  type WebToolErrorCode,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import { formatWebFetchOutput } from "./web-result-format.js";
import {
  sanitizeWebText,
  validateWebAccess,
} from "./web-policy.js";
import {
  optionalNumber,
  requireString,
  toErrorResult,
  toSuccessResult,
} from "./tool-helpers.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BYTES = 200_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const SUPPORTED_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "text/xml",
] as const;

export interface WebFetchClientRequest {
  readonly url: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface WebFetchClientResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType?: string;
  readonly body: string;
  readonly bytesRead: number;
  readonly redirectChain: readonly string[];
}

export type WebFetchClient = (request: WebFetchClientRequest) => Promise<WebFetchClientResponse>;

export interface WebFetchToolOptions {
  readonly fetchClient?: WebFetchClient;
  readonly networkPolicy?: SandboxPolicy;
}

export class WebFetchTool implements DevTool {
  readonly name = "web_fetch";
  readonly description = TOOL_SCHEMAS.web_fetch.description;
  readonly inputSchema = TOOL_SCHEMAS.web_fetch.inputSchema;

  private readonly fetchClient: WebFetchClient;
  private readonly networkPolicy?: SandboxPolicy;

  constructor(options: WebFetchToolOptions = {}) {
    this.fetchClient = options.fetchClient ?? nativeWebFetchClient;
    this.networkPolicy = options.networkPolicy;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const urlInput = requireString(input, "url");
    if (!urlInput.ok) {
      return urlInput.result;
    }
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }
    const timeoutInput = parseBoundedNumber(input, "timeout", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    if (!timeoutInput.ok) {
      return this.error(urlInput.value, timeoutInput.message, "invalid_input", verbosityInput.value);
    }
    const maxBytesInput = parseBoundedNumber(input, "maxBytes", DEFAULT_MAX_BYTES, MAX_BYTES);
    if (!maxBytesInput.ok) {
      return this.error(urlInput.value, maxBytesInput.message, "invalid_input", verbosityInput.value);
    }

    const access = validateWebAccess({
      url: urlInput.value,
      sandbox,
      policy: this.networkPolicy,
    });
    if (!access.ok) {
      return this.error(urlInput.value, access.message, access.errorCode, verbosityInput.value);
    }

    try {
      const response = await this.fetchClient({
        url: access.url,
        timeoutMs: timeoutInput.value,
        maxBytes: maxBytesInput.value,
      });
      const redirectValidation = validateRedirectChain(response.redirectChain, sandbox, this.networkPolicy);
      if (!redirectValidation.ok) {
        return toErrorResult(redirectValidation.message, webToolMetadata("web_fetch", {
          operation: "fetch",
          url: urlInput.value,
          normalizedUrl: response.url,
          status: response.status,
          contentType: response.contentType,
          bytesRead: response.bytesRead,
          truncated: response.bytesRead > maxBytesInput.value,
          redirectChain: response.redirectChain,
          errorCode: redirectValidation.errorCode,
          verbosity: verbosityInput.value,
        }));
      }

      if (response.status >= 400) {
        const errorCode: WebToolErrorCode = response.status === 429 ? "too_many_requests" : "unavailable";
        return toErrorResult(`Fetch returned ${response.status}`, webToolMetadata("web_fetch", {
          operation: "fetch",
          url: urlInput.value,
          normalizedUrl: response.url,
          status: response.status,
          contentType: response.contentType,
          bytesRead: response.bytesRead,
          truncated: response.bytesRead > maxBytesInput.value,
          redirectChain: response.redirectChain,
          errorCode,
          verbosity: verbosityInput.value,
        }));
      }

      if (!isSupportedContentType(response.contentType)) {
        return toErrorResult(`Unsupported content type: ${response.contentType ?? "<unknown>"}`, webToolMetadata("web_fetch", {
          operation: "fetch",
          url: urlInput.value,
          normalizedUrl: response.url,
          status: response.status,
          contentType: response.contentType,
          bytesRead: response.bytesRead,
          truncated: false,
          redirectChain: response.redirectChain,
          errorCode: "unsupported_content_type",
          verbosity: verbosityInput.value,
        }));
      }

      const clipped = clipToBytes(response.body, maxBytesInput.value);
      const text = sanitizeWebText(clipped.text);
      const metadata = webToolMetadata("web_fetch", {
        operation: "fetch",
        url: urlInput.value,
        normalizedUrl: response.url,
        retrievedAt: new Date().toISOString(),
        status: response.status,
        contentType: response.contentType,
        bytesRead: response.bytesRead,
        truncated: clipped.truncated || response.bytesRead > maxBytesInput.value,
        redirectChain: response.redirectChain,
        verbosity: verbosityInput.value,
      });

      return toSuccessResult(formatWebFetchOutput({
        url: response.url,
        text,
        status: response.status,
        contentType: response.contentType,
        truncated: metadata.truncated ?? false,
      }, verbosityInput.value), metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code: WebToolErrorCode = /abort|timeout/i.test(message) ? "timeout" : "unavailable";
      return this.error(urlInput.value, message, code, verbosityInput.value);
    }
  }

  private error(
    url: string,
    message: string,
    errorCode: WebToolErrorCode,
    verbosity: ToolOutputVerbosity,
  ): ToolResult {
    return toErrorResult(message, webToolMetadata("web_fetch", {
      operation: "fetch",
      url,
      errorCode,
      verbosity,
    }));
  }
}

async function nativeWebFetchClient(request: WebFetchClientRequest): Promise<WebFetchClientResponse> {
  const redirectChain: string[] = [request.url];
  let currentUrl = request.url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,text/plain,text/markdown,application/json,application/xml,text/xml,*/*;q=0.1" },
      });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect response ${response.status} did not include a Location header`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirectChain.push(currentUrl);
        continue;
      }

      const bodyBuffer = Buffer.from(await response.arrayBuffer());
      const bytesRead = bodyBuffer.byteLength;
      const body = bodyBuffer.subarray(0, request.maxBytes).toString("utf8");
      return {
        url: currentUrl,
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        body,
        bytesRead,
        redirectChain,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Too many redirects after ${MAX_REDIRECTS} hops`);
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

function validateRedirectChain(
  redirectChain: readonly string[],
  sandbox: unknown,
  policy: SandboxPolicy | undefined,
): { ok: true } | { ok: false; message: string; errorCode: WebToolErrorCode } {
  for (const url of redirectChain) {
    const access = validateWebAccess({ url, sandbox, policy });
    if (!access.ok) {
      return { ok: false, message: access.message, errorCode: access.errorCode };
    }
  }
  return { ok: true };
}

function isSupportedContentType(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const normalized = value.split(";")[0]!.trim().toLowerCase();
  return SUPPORTED_CONTENT_TYPES.some((contentType) => normalized === contentType);
}

function clipToBytes(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }
  return { text: buffer.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
