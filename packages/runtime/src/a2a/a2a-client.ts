import { lookup as lookupDns } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity as verifyTlsServerIdentity } from "node:tls";
import type { AgentCard, CancelTaskRequest, Message, SendMessageRequest, SendMessageResult } from "@a2a-js/sdk";
import type { RequestOptions } from "@a2a-js/sdk/client";
import { ClientFactory, DefaultAgentCardResolver, JsonRpcTransportFactory } from "@a2a-js/sdk/client";
import { KilnError } from "@kilnai/core";

export interface A2ARemoteClient {
  getAgentCard(options?: RequestOptions): Promise<AgentCard>;
  sendMessage(request: SendMessageRequest, options?: RequestOptions): Promise<SendMessageResult>;
  cancelTask(request: CancelTaskRequest, options?: RequestOptions): Promise<unknown>;
}

export interface A2AClientFactory {
  createFromUrl(agentUrl: string): Promise<A2ARemoteClient>;
}

export interface A2AClientPort {
  discoverAgent(agentUrl: string): Promise<AgentCard>;
  sendMessage(agentUrl: string, message: Message, timeoutMs?: number): Promise<SendMessageResult>;
  cancelTask(agentUrl: string, taskId: string, timeoutMs: number): Promise<void>;
}

export interface A2AHostnameResolver {
  lookup(hostname: string): Promise<readonly string[]>;
}

/**
 * Owns the connection boundary after Kiln has approved every resolved address.
 * Implementations must connect only to one of `resolvedAddresses`; resolving
 * the hostname again would violate this contract.
 */
export interface A2AEgressFetchPort {
  fetch(
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    resolvedAddresses: readonly string[],
  ): Promise<Response>;
}

type A2AHttpsRequest = (options: HttpsRequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

/**
 * The transport cap allows the existing 1 MiB extracted text budget plus a
 * bounded JSON-RPC/envelope allowance. It applies before SDK parsing.
 */
export const A2A_MAX_RESPONSE_BYTES = 1_048_576 + 64 * 1024;

const defaultResolver: A2AHostnameResolver = {
  async lookup(hostname) {
    return (await lookupDns(hostname, { all: true, verbatim: true })).map((answer) => answer.address);
  },
};

/** Stable timeout signal for callers; details never depend on SDK error text. */
export class A2ATimeoutError extends KilnError {
  constructor(message = "A2A operation timed out") {
    super("A2A_TIMEOUT", message, {
      context: { failureKind: "timeout" },
      retryable: true,
    });
    this.name = "A2ATimeoutError";
  }
}

type A2AResponseLimitFailureKind = "invalid-content-length" | "response-too-large";

/** Stable, sanitized transport-bound failure; it is never a timeout. */
export class A2AResponseLimitError extends KilnError {
  constructor(failureKind: A2AResponseLimitFailureKind) {
    super(
      "A2A_CLIENT_FAILED",
      failureKind === "invalid-content-length"
        ? "A2A response Content-Length is invalid."
        : "A2A response exceeded the transport byte limit.",
      {
        context: {
          operation: "https-egress",
          failureKind,
          maxBytes: A2A_MAX_RESPONSE_BYTES,
        },
      },
    );
    this.name = "A2AResponseLimitError";
  }
}

/** Small Kiln adapter over the official A2A v1 client and transport negotiation. */
export class A2AClient implements A2AClientPort {
  private readonly factory: A2AClientFactory;

  constructor(
    factory?: A2AClientFactory,
    private readonly resolver: A2AHostnameResolver = defaultResolver,
    egress: A2AEgressFetchPort = createPinnedHttpsA2AEgressFetch(),
  ) {
    this.factory = factory ?? createOfficialA2AClientFactory(resolver, egress);
  }

  async discoverAgent(agentUrl: string, timeoutMs?: number): Promise<AgentCard> {
    await validateA2AAgentUrl(agentUrl, this.resolver);
    try {
      return await withDeadline(async (signal) => {
        const client = await this.factory.createFromUrl(agentUrl);
        return client.getAgentCard({ signal });
      }, timeoutMs);
    } catch (cause) {
      if (cause instanceof A2ATimeoutError) throw cause;
      throw new KilnError("A2A_CLIENT_FAILED", "A2A agent discovery failed", {
        context: { operation: "discover-agent" },
        cause,
      });
    }
  }

  async sendMessage(agentUrl: string, message: Message, timeoutMs?: number): Promise<SendMessageResult> {
    await validateA2AAgentUrl(agentUrl, this.resolver);
    try {
      return await withDeadline(async (signal) => {
        const client = await this.factory.createFromUrl(agentUrl);
        return client.sendMessage(
          {
            tenant: "",
            message,
            configuration: undefined,
            metadata: undefined,
          },
          { signal },
        );
      }, timeoutMs);
    } catch (cause) {
      if (cause instanceof A2ATimeoutError) {
        throw new A2ATimeoutError("A2A message request timed out");
      }
      throw new KilnError("A2A_CLIENT_FAILED", "A2A message request failed", {
        context: { operation: "send-message" },
        cause,
      });
    }
  }

  async cancelTask(agentUrl: string, taskId: string, timeoutMs: number): Promise<void> {
    await validateA2AAgentUrl(agentUrl, this.resolver);
    try {
      await withDeadline(async (signal) => {
        const client = await this.factory.createFromUrl(agentUrl);
        await client.cancelTask({ tenant: "", id: taskId, metadata: undefined }, { signal });
      }, timeoutMs);
    } catch (cause) {
      if (cause instanceof A2ATimeoutError) throw cause;
      throw new KilnError("A2A_CLIENT_FAILED", "A2A task cancellation failed", {
        context: { operation: "cancel-task" },
        cause,
      });
    }
  }
}

/**
 * The official SDK owns A2A wire serialization. This guarded fetch is its only
 * network ingress and revalidates every SDK URL (including Agent Card endpoints).
 */
export function createOfficialA2AClientFactory(
  resolver: A2AHostnameResolver = defaultResolver,
  egress: A2AEgressFetchPort = createPinnedHttpsA2AEgressFetch(),
): A2AClientFactory {
  const guardedFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const requestedUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
      const resolvedAddresses = await resolveA2AAgentUrl(requestedUrl, resolver);
      return egress.fetch(input, { ...init, redirect: "error" }, resolvedAddresses);
    },
    // Preconnecting cannot carry the per-request approved-address authority.
    { preconnect: () => undefined },
  ) satisfies typeof fetch;
  return new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl: guardedFetch })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: guardedFetch }),
  });
}

export async function validateA2AAgentUrl(
  value: string,
  resolver: A2AHostnameResolver = defaultResolver,
): Promise<void> {
  await resolveA2AAgentUrl(value, resolver);
}

async function resolveA2AAgentUrl(value: string, resolver: A2AHostnameResolver): Promise<readonly string[]> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidA2ATarget();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hostname === ""
  ) {
    throw invalidA2ATarget();
  }
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  let addresses: readonly string[];
  try {
    addresses = isIP(host) === 0 ? await resolver.lookup(host) : [host];
  } catch {
    throw invalidA2ATarget();
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw invalidA2ATarget();
  }
  return addresses;
}

/**
 * Fetch-compatible HTTPS egress that never asks the platform to resolve the
 * target hostname. The original hostname remains the HTTP Host and TLS SNI /
 * certificate identity while the TCP connection uses an approved address.
 */
export function createPinnedHttpsA2AEgressFetch(httpsRequest: A2AHttpsRequest = requestHttps): A2AEgressFetchPort {
  return {
    async fetch(input, init, resolvedAddresses) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const address = resolvedAddresses[0];
      if (url.protocol !== "https:" || address === undefined || !resolvedAddresses.every(isPublicAddress)) {
        throw invalidA2ATarget();
      }
      const body =
        request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
      const headers = Object.fromEntries(request.headers.entries());
      headers.host = url.host;
      const originalHostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;

      return await new Promise<Response>((resolve, reject) => {
        let settled = false;
        let incoming: IncomingMessage | undefined;
        let outgoing: ClientRequest | undefined;
        let stopCollecting: (() => void) | undefined;

        const finish = (outcome: HttpsResponseOutcome): void => {
          if (settled) return;
          settled = true;
          stopCollecting?.();
          if (outgoing !== undefined) outgoing.removeListener("error", onOutgoingError);
          if (outcome.kind === "response") {
            resolve(outcome.response);
            return;
          }
          if (outcome.destroyIncoming) incoming?.destroy();
          if (outcome.destroyOutgoing) outgoing?.destroy();
          reject(outcome.error);
        };
        const onOutgoingError = (error: unknown): void => finish({ kind: "error", error });

        try {
          outgoing = httpsRequest(
            {
              protocol: "https:",
              hostname: address,
              port: 443,
              path: `${url.pathname}${url.search}`,
              method: request.method,
              headers,
              agent: false,
              rejectUnauthorized: true,
              servername: isIP(originalHostname) === 0 ? originalHostname : undefined,
              checkServerIdentity: (_hostname, certificate) => verifyTlsServerIdentity(originalHostname, certificate),
              signal: request.signal,
            },
            (response) => {
              incoming = response;
              stopCollecting = collectHttpsResponse(response, finish);
            },
          );
          if (settled) {
            outgoing.destroy();
            return;
          }
          outgoing.once("error", onOutgoingError);
          outgoing.end(body);
        } catch (error) {
          finish({ kind: "error", error });
        }
      });
    },
  };
}

type HttpsResponseOutcome =
  | { readonly kind: "response"; readonly response: Response }
  | {
      readonly kind: "error";
      readonly error: unknown;
      readonly destroyIncoming?: boolean;
      readonly destroyOutgoing?: boolean;
    };

function collectHttpsResponse(
  incoming: IncomingMessage,
  complete: (outcome: HttpsResponseOutcome) => void,
): () => void {
  let active = true;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const cleanup = (): void => {
    incoming.removeListener("data", onData);
    incoming.removeListener("error", onError);
    incoming.removeListener("aborted", onAborted);
    incoming.removeListener("close", onClose);
    incoming.removeListener("end", onEnd);
  };
  const finish = (outcome: HttpsResponseOutcome): void => {
    if (!active) return;
    active = false;
    cleanup();
    complete(outcome);
  };
  const fail = (error: unknown, destroyIncoming = false, destroyOutgoing = false): void => {
    finish({ kind: "error", error, destroyIncoming, destroyOutgoing });
  };
  const onData = (chunk: Buffer | Uint8Array | string): void => {
    if (!active) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.byteLength > A2A_MAX_RESPONSE_BYTES - totalBytes) {
      fail(new A2AResponseLimitError("response-too-large"), true, true);
      return;
    }
    totalBytes += bytes.byteLength;
    chunks.push(bytes);
  };
  const onError = (error: unknown): void => fail(error);
  const onAborted = (): void =>
    fail(
      new KilnError("A2A_CLIENT_FAILED", "A2A response stream was aborted.", {
        context: { operation: "https-egress", failureKind: "response-aborted" },
      }),
    );
  const onClose = (): void => {
    if (active) {
      fail(
        new KilnError("A2A_CLIENT_FAILED", "A2A response stream closed before completion.", {
          context: { operation: "https-egress", failureKind: "response-closed" },
        }),
      );
    }
  };
  const onEnd = (): void => {
    if (!active) return;
    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index];
      const value = incoming.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined) headers.append(name, value);
    }
    const status = incoming.statusCode ?? 0;
    const hasNoBody = status === 204 || status === 205 || status === 304;
    finish({
      kind: "response",
      response: new Response(hasNoBody ? null : Buffer.concat(chunks), {
        status,
        statusText: incoming.statusMessage,
        headers,
      }),
    });
  };

  const declaredLength = readResponseContentLength(incoming);
  if (declaredLength.kind === "invalid") {
    fail(new A2AResponseLimitError("invalid-content-length"), true, true);
    return () => undefined;
  }
  if (declaredLength.value !== undefined && declaredLength.value > A2A_MAX_RESPONSE_BYTES) {
    fail(new A2AResponseLimitError("response-too-large"), true, true);
    return () => undefined;
  }

  const status = incoming.statusCode ?? 0;
  if (status >= 300 && status < 400) {
    fail(new TypeError("A2A redirects are not allowed"), true, true);
    return () => undefined;
  }
  incoming.on("data", onData);
  incoming.once("error", onError);
  incoming.once("aborted", onAborted);
  incoming.once("close", onClose);
  incoming.once("end", onEnd);
  return () => {
    if (!active) return;
    active = false;
    cleanup();
  };
}

function readResponseContentLength(
  incoming: IncomingMessage,
): { readonly kind: "valid"; readonly value?: number } | { readonly kind: "invalid" } {
  const rawHeader = incoming.headers?.["content-length"];
  if (rawHeader === undefined) return { kind: "valid" };
  if (Array.isArray(rawHeader) || !/^\d+$/u.test(rawHeader)) return { kind: "invalid" };
  const value = Number(rawHeader);
  return Number.isSafeInteger(value) ? { kind: "valid", value } : { kind: "invalid" };
}

function invalidA2ATarget(): KilnError {
  return new KilnError("A2A_CLIENT_FAILED", "A2A target must be a public canonical HTTPS endpoint.", {
    context: { failureKind: "invalid-target" },
  });
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4) return false;
    const a = octets[0];
    const b = octets[1];
    if (a === undefined || b === undefined) return false;
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a < 224 &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && (b === 0 || b === 168)) &&
      !(a === 198 && (b === 18 || b === 19)) &&
      !(a === 198 && b === 51) &&
      !(a === 203 && b === 0)
    );
  }
  if (version !== 6) return false;
  const words = ipv6Words(address);
  if (!words) return false;
  const first = words[0]!;
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1))
    return false;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && words[1] === 0x0db8) return false;
  if (words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff)) {
    const mapped = `${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`;
    return isPublicAddress(mapped);
  }
  return true;
}

function ipv6Words(value: string): readonly number[] | undefined {
  const normalized = value.toLowerCase();
  const [left, right] = normalized.split("::", 2);
  if (normalized.split("::").length > 2) return undefined;
  const parse = (section: string | undefined): number[] | undefined => {
    if (!section) return [];
    const pieces = section.split(":");
    const words: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        if (isIP(piece) !== 4) return undefined;
        const octets = piece.split(".").map(Number);
        words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else if (/^[0-9a-f]{1,4}$/u.test(piece)) words.push(Number.parseInt(piece, 16));
      else return undefined;
    }
    return words;
  };
  const leading = parse(left);
  const trailing = parse(right);
  if (!leading || !trailing) return undefined;
  if (normalized.includes("::")) {
    const omitted = 8 - leading.length - trailing.length;
    return omitted < 1 ? undefined : [...leading, ...Array<number>(omitted).fill(0), ...trailing];
  }
  return leading.length === 8 ? leading : undefined;
}

async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T> {
  const controller = new AbortController();
  if (timeoutMs === undefined) return operation(controller.signal);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new A2ATimeoutError();
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
