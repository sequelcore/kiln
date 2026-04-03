/**
 * @fileoverview TUI Gateway session implementation.
 * @module @kilnai/tui
 */

import { randomUUID } from "node:crypto";
import type { SessionLike } from "./types.js";
import type { SessionEventInternal } from "./types.js";
import { TuiWsClient } from "./ws-client.js";
import type { TuiInboundFrame } from "./ws-client.js";

const CONNECT_TIMEOUT_MS = 10_000;
const SEND_CONNECTED_TIMEOUT_MS = 5_000;
const CLEAR_TIMEOUT_MS = 5_000;

const STOP = Symbol("STOP");

type QueueItem = SessionEventInternal | typeof STOP;

/**
 * GatewaySession — TUI's SessionLike implementation backed by the local gateway WS.
 *
 * One GatewaySession maps to one user conversation.
 * Session history lives in the gateway's ModeBSession; this class is stateless.
 */
export class GatewaySession implements SessionLike {
  private readonly client: TuiWsClient;
  private readonly userId: string;

  /** Pending queue items for the current turn. Set while a turn is in flight. */
  private queue: QueueItem[] = [];
  private resolve: (() => void) | null = null;
  private connected = false;

  /** Pending clear callbacks — set while waiting for "cleared" frame. */
  private clearCallbacks: { resolve: () => void; reject: (err: Error) => void } | null = null;

  /** Pending provider change callbacks — set while waiting for "provider_changed" frame. */
  private providerChangeCallbacks: { resolve: (provider: string) => void; reject: (err: Error) => void } | null = null;

  constructor(wsUrl: string) {
    this.userId = `kiln-tui-${randomUUID()}`;

    this.client = new TuiWsClient({
      url: wsUrl,
      userId: this.userId,
      onMessage: (frame) => this.handleFrame(frame),
      onOpen: () => {
        this.connected = true;
      },
      onClose: () => {
        this.connected = false;
      },
    });

    this.client.connect();
  }

  async *run(opts: { prompt: string; cwd?: string }): AsyncGenerator<SessionEventInternal> {
    // Wait for connection to be established
    await this.waitForConnection();

    // Reset queue for this turn
    this.queue = [];
    this.resolve = null;

    // Send the user message
    this.client.send({ type: "message", content: opts.prompt });

    yield* this.drainQueue();
  }

  /**
   * Send a clear frame to the gateway and wait for the cleared acknowledgement.
   * Resolves when the gateway confirms. Rejects after CLEAR_TIMEOUT_MS.
   * Not part of SessionLike — duck-typed in app.tsx.
   */
  async clear(): Promise<void> {
    await this.waitForConnection();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.clearCallbacks = null;
        reject(new Error("Clear timed out"));
      }, CLEAR_TIMEOUT_MS);

      this.clearCallbacks = {
        resolve: () => {
          clearTimeout(timeout);
          this.clearCallbacks = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.clearCallbacks = null;
          reject(err);
        },
      };

      this.client.send({ type: "clear" });
    });
  }

  /**
   * Send a provider frame to the gateway and wait for the provider_changed acknowledgement.
   * Resolves with the new provider name. Rejects after timeout.
   */
  async switchProvider(provider: string): Promise<string> {
    await this.waitForConnection();
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.providerChangeCallbacks = null;
        reject(new Error("Provider switch timed out"));
      }, CLEAR_TIMEOUT_MS);

      this.providerChangeCallbacks = {
        resolve: (newProvider: string) => {
          clearTimeout(timeout);
          this.providerChangeCallbacks = null;
          resolve(newProvider);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.providerChangeCallbacks = null;
          reject(err);
        },
      };

      this.client.send({ type: "provider", provider });
    });
  }

  async dispose(): Promise<void> {
    this.client.disconnect();
    // Unblock any waiting iterator
    this.pushStop();
  }

  private handleFrame(frame: TuiInboundFrame): void {
    if (frame.type === "thinking") {
      this.push({ type: "thinking" });
    } else if (frame.type === "activity") {
      this.push({
        type: "activity",
        activity: frame.activity,
        toolName: frame.toolName,
        output: frame.output,
        usd: frame.usd,
        inputTokens: frame.inputTokens,
        outputTokens: frame.outputTokens,
      });
    } else if (frame.type === "done") {
      // Phase 7c: synthesize text_delta from full done content
      if (frame.content) {
        this.push({ type: "text_delta", content: frame.content });
      }
      // Pass through token counts from the gateway
      this.push({ 
        type: "completed", 
        totalUsd: 0,
        inputTokens: frame.inputTokens,
        outputTokens: frame.outputTokens
      });
      this.pushStop();
    } else if (frame.type === "error") {
      this.push({ type: "error", message: frame.message });
      this.pushStop();
    }
    // welcome frame: ignored (TUI doesn't need a greeting)
    // cleared frame: resolve pending clear promise
    if (frame.type === "cleared") {
      this.clearCallbacks?.resolve();
    }
    // provider_changed frame: resolve pending provider switch promise
    if (frame.type === "provider_changed") {
      this.providerChangeCallbacks?.resolve(frame.provider);
    }
  }

  private push(event: SessionEventInternal): void {
    this.queue.push(event);
    this.resolveQueue();
  }

  private pushStop(): void {
    this.queue.push(STOP);
    this.resolveQueue();
  }

  private resolveQueue(): void {
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  private async *drainQueue(): AsyncIterable<SessionEventInternal> {
    while (true) {
      if (this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (item === STOP) return;
        yield item;
        // After yielding, check if more items arrived before waiting
        if (this.queue.length > 0) continue;
      }
      // Wait for next push
      await new Promise<void>((res) => {
        this.resolve = res;
      });
    }
  }

  private waitForConnection(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error("TUI gateway connection timed out"));
      }, CONNECT_TIMEOUT_MS);

      const poll = setInterval(() => {
        if (this.connected) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve();
        }
      }, 50);
    });
  }
}

/**
 * Wait until the gateway is reachable on the given health URL.
 * Used by the CLI command to confirm startTuiGateway() is ready before connecting.
 */
export async function waitForGateway(healthUrl: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(SEND_CONNECTED_TIMEOUT_MS) });
      if (res.ok) return;
    } catch {
      // Not ready yet — retry
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`TUI gateway did not become ready within ${timeoutMs}ms`);
}
