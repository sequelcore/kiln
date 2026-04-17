/**
 * @fileoverview Gateway readiness wait function.
 * @module @kilnai/gui
 */

/**
 * Error thrown when the gateway does not become ready within the timeout period.
 */
export class GatewayTimeoutError extends Error {
  constructor(baseUrl: string, timeoutMs: number) {
    super(`Gateway at ${baseUrl} did not become ready within ${timeoutMs}ms`);
    this.name = "GatewayTimeoutError";
  }
}

/**
 * Wait until the gateway is reachable on the given base URL.
 * Polls GET <baseUrl>/health until it returns 200.
 */
export async function waitForGateway(
  baseUrl: string,
  { intervalMs = 200, timeoutMs = 10_000 } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${baseUrl}/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(intervalMs),
      });
      if (res.ok) return;
    } catch {
      // Not ready yet — retry
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }

  throw new GatewayTimeoutError(baseUrl, timeoutMs);
}