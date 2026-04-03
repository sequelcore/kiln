import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import { textParts, extractText } from "@kilnai/core";
import type { CliSessionFactory, CliSessionEvent } from "../execution/cli-subscription-executor.js";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";

export interface TuiGatewayOptions {
  /** Port for the TUI gateway. Default: 4801. */
  readonly port?: number;
  /**
   * Human-readable provider label (e.g. "claude", "codex", "opencode").
   * Used only for logging and executor naming.
   */
  readonly provider?: string;
  /**
   * Factory that creates a CLI session per turn.
   * Injected by packages/cli/src/commands/tui.ts.
   * Runtime defines the interface; CLI provides the implementation.
   */
  readonly sessionFactory: CliSessionFactory;
  /** System prompt for the TUI session. Default: "You are a helpful assistant." */
  readonly systemPrompt?: string;
  /**
   * Optional callback invoked when the TUI sends a { type: "clear" } frame.
   * Should reset the persisted session ID so the next turn starts fresh.
   * Fail-open: errors are swallowed and { type: "cleared" } is still sent.
   */
  readonly onClear?: () => Promise<void>;
}

export interface TuiGateway {
  /** WebSocket URL to connect to. e.g. "ws://localhost:4801/tui/ws" */
  readonly url: string;
  readonly port: number;
  /** Gracefully stop the gateway server. */
  shutdown(): void;
}

const TUI_APP_NAME = "kiln-tui";
const TUI_TENANT_ID = "_tui";

/**
 * Start the in-process TUI gateway.
 *
 * Returns immediately after the server is listening.
 * The caller (tui.ts CLI command) holds the returned TuiGateway and calls
 * shutdown() on process exit.
 */
export async function startTuiGateway(options: TuiGatewayOptions): Promise<TuiGateway> {
  const port = options.port ?? 4801;
  const providerLabel = options.provider ?? "claude";
  const systemPrompt = options.systemPrompt ?? "You are a helpful assistant.";

  // Activity streamer: bridges CLI session events to the active WS connection
  const activityStreamer = new TuiActivityStreamer();

  const executor = new CliSubscriptionExecutor(
    options.sessionFactory,
    providerLabel,
    (event) => activityStreamer.forward(event),
  );
  const orchestrator = new ModeBOrchestrator({ provider: executor });
  const sessionRegistry = new SessionRegistry();

  const { upgradeWebSocket, websocket } = createBunWebSocket();

  const app = new Hono();

  // Health check — polled by the CLI to confirm gateway is ready
  app.get("/health", (c) => c.json({ status: "ok", channel: "tui" }));

  // TUI WebSocket endpoint — no widgetId, no tenant, just userId
  app.get(
    "/tui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();

      return {
        async onOpen(_event: Event, ws: WSContext) {
          activityStreamer.register(ws);
        },

        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);

            const frame = JSON.parse(raw) as Record<string, unknown>;

            if (frame.type === "clear") {
              try {
                await options.onClear?.();
              } catch {
                // Fail-open: log nothing, still acknowledge
              }
              ws.send(JSON.stringify({ type: "cleared" }));
              return;
            }

            if (frame.type !== "message") return;

            const userContent = typeof frame.content === "string"
              ? frame.content
              : "";

            if (!userContent.trim()) return;

            // Send "thinking" status to indicate work has started
            ws.send(JSON.stringify({ type: "thinking" }));

            const session = await sessionRegistry.getOrCreate({
              appName: TUI_APP_NAME,
              tenantId: TUI_TENANT_ID,
              userId,
              systemPrompt,
            });

            let result;
            try {
              result = await orchestrator.processMessage(
                session,
                textParts(userContent),
              );
            } catch (err) {
              ws.send(JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              }));
              return;
            }

            await sessionRegistry.save(session);

            ws.send(JSON.stringify({
              type: "done",
              content: extractText(result.parts),
              parts: result.parts,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            }));
          } catch {
            // Discard malformed frames
          }
        },

        onClose(_event: CloseEvent, ws: WSContext) {
          activityStreamer.unregister(ws);
          // Session persists across reconnects (stored in sessionRegistry)
        },
      };
    }),
  );

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });

  return {
    url: `ws://localhost:${port}/tui/ws`,
    port,
    shutdown: () => server.stop(),
  };
}

/**
 * Bridges CLI session events to the active WebSocket connection.
 *
 * The TUI gateway has exactly one WS connection at a time. This class
 * holds a reference to the current WS and forwards activity events
 * (tool_use, tool_result, cost_update, thinking) as they arrive from
 * the CliSubscriptionExecutor.
 */
class TuiActivityStreamer {
  private ws: WSContext | null = null;

  register(ws: WSContext): void {
    this.ws = ws;
  }

  unregister(ws: WSContext): void {
    if (this.ws === ws) this.ws = null;
  }

  forward(event: CliSessionEvent): void {
    if (!this.ws) return;

    // Only forward activity events, not raw text deltas or completion
    if (event.type === "tool_use") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "tool_use",
        toolName: event.toolName,
        input: event.input,
      }));
    } else if (event.type === "tool_result") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "tool_result",
        toolName: event.toolName,
        output: event.output,
      }));
    } else if (event.type === "cost_update") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "cost_update",
        usd: event.usd,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      }));
    }
    // text_delta, completed, error are handled by the gateway's done frame
  }
}
