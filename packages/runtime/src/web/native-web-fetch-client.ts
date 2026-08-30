import type { WebFetchClient, WebFetchClientRequest, WebFetchClientResponse } from "@kilnai/core/tools";

const MAX_REDIRECTS = 5;
const ACCEPTED_CONTENT_TYPES = "text/html,text/plain,text/markdown,application/json,application/xml,text/xml,*/*;q=0.1";

export interface NativeWebFetchClientOptions {
  readonly fetchImpl?: NativeFetchImplementation;
}

export type NativeFetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Runtime-owned native network adapter for Core's policy-first web fetch tool. */
export function createNativeWebFetchClient(options: NativeWebFetchClientOptions = {}): WebFetchClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return (request) => nativeWebFetch(fetchImpl, request);
}

async function nativeWebFetch(
  fetchImpl: NativeFetchImplementation,
  request: WebFetchClientRequest,
): Promise<WebFetchClientResponse> {
  const redirectChain: string[] = [request.url];
  let currentUrl = request.url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: ACCEPTED_CONTENT_TYPES },
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
      return {
        url: currentUrl,
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        body: bodyBuffer.subarray(0, request.maxBytes).toString("utf8"),
        bytesRead: bodyBuffer.byteLength,
        redirectChain,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Too many redirects after ${MAX_REDIRECTS} hops`);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
