import { domainToASCII } from "node:url";
import { NetworkFilter } from "../../sandbox/network-filter.js";
import type { SandboxPolicy } from "../../sandbox/policies.js";
import type { WebToolErrorCode } from "../domain/tool-result-metadata.js";
import { getSandboxContext } from "./tool-helpers.js";

export type WebPolicyResult<T> =
  | ({ readonly ok: true } & T)
  | {
    readonly ok: false;
    readonly message: string;
    readonly errorCode: WebToolErrorCode;
  };

export interface NormalizedWebUrl {
  readonly url: string;
  readonly hostname: string;
}

export interface WebAccessValidation {
  readonly url: string;
  readonly hostname: string;
  readonly domains: readonly string[];
}

export function normalizeWebUrl(input: string): WebPolicyResult<NormalizedWebUrl> {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, message: `Invalid URL: ${input}`, errorCode: "invalid_input" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Invalid URL: only http and https are supported", errorCode: "invalid_input" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, message: "Invalid URL: embedded credentials are not allowed", errorCode: "invalid_input" };
  }

  parsed.hash = "";
  const hostname = asciiHostname(parsed.hostname);
  if (!hostname) {
    return { ok: false, message: `Invalid URL hostname: ${input}`, errorCode: "invalid_input" };
  }

  if (isPrivateOrLocalHostname(hostname)) {
    return { ok: false, message: `Network access denied: ${hostname}`, errorCode: "network_denied" };
  }

  parsed.hostname = hostname;
  return { ok: true, url: parsed.toString(), hostname };
}

export function normalizeWebDomain(input: string): WebPolicyResult<{ readonly domain: string }> {
  const trimmed = input.trim();
  if (
    trimmed.length === 0
    || trimmed === "*"
    || /[:/?#@]/.test(trimmed)
  ) {
    return { ok: false, message: `Invalid domain: ${input}`, errorCode: "invalid_input" };
  }

  const domain = asciiHostname(trimmed);
  if (!domain || isPrivateOrLocalHostname(domain)) {
    return { ok: false, message: `Invalid domain: ${input}`, errorCode: "invalid_input" };
  }

  return { ok: true, domain };
}

export function normalizeWebDomains(value: unknown): WebPolicyResult<{ readonly domains: readonly string[] }> {
  if (value === undefined) {
    return { ok: true, domains: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: 'Invalid input: "domains" must be an array of domain strings', errorCode: "invalid_input" };
  }

  const domains: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, message: 'Invalid input: "domains" must contain only strings', errorCode: "invalid_input" };
    }
    const normalized = normalizeWebDomain(item);
    if (!normalized.ok) {
      return normalized;
    }
    if (!domains.includes(normalized.domain)) {
      domains.push(normalized.domain);
    }
  }
  return { ok: true, domains };
}

export function validateWebAccess(input: {
  readonly url: string;
  readonly domains?: readonly string[];
  readonly sandbox?: unknown;
  readonly policy?: SandboxPolicy;
}): WebPolicyResult<WebAccessValidation> {
  const normalized = normalizeWebUrl(input.url);
  if (!normalized.ok) {
    return normalized;
  }

  const domains = input.domains ?? [];
  if (domains.length > 0 && !domains.some((domain) => domainMatches(normalized.hostname, domain))) {
    return {
      ok: false,
      message: `Domain access denied: ${normalized.hostname}`,
      errorCode: "network_denied",
    };
  }

  const policy = input.policy ?? getSandboxContext(input.sandbox)?.policy;
  if (!policy) {
    return {
      ok: false,
      message: "Network access denied: explicit network policy is required",
      errorCode: "network_denied",
    };
  }

  const policyResult = new NetworkFilter({ policy }).validateUrl(normalized.url);
  if (!policyResult.allowed) {
    return {
      ok: false,
      message: policyResult.reason ?? `Network access denied: ${normalized.hostname}`,
      errorCode: "network_denied",
    };
  }

  return {
    ok: true,
    url: normalized.url,
    hostname: normalized.hostname,
    domains,
  };
}

export function sanitizeWebText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function asciiHostname(input: string): string {
  const normalized = domainToASCII(input.trim().replace(/\.$/, "").toLowerCase());
  return normalized;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname === "[::1]"
  ) {
    return true;
  }

  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) {
    return false;
  }

  const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const a = octets[0]!;
  const b = octets[1]!;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}
