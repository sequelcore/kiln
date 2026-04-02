import type { PersistedTranscriptEvent } from "@kilnai/core";
import { buildPreamble } from "../wrapper/preamble-builder.js";
import type {
  ProviderId,
  SessionRequirements,
  PermissionEvaluator,
} from "../wrapper/index.js";
import { createPermissionEvaluator } from "../wrapper/index.js";
import type {
  ProviderCreateConfig,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import type { CleanupRegistry } from "../wrapper/cleanup-registry.js";
import type { SessionManager } from "../wrapper/session-manager.js";
import type { SessionContext } from "../wrapper/index.js";
import { SessionHooks } from "./session-hooks.js";
import { governSessionContext } from "./context-governance.js";

export interface RunSessionOptions {
  readonly registry: SessionRegistry;
  readonly cleanupRegistry: CleanupRegistry;
  readonly manager: SessionManager;
  readonly context: SessionContext;
  readonly requirements: SessionRequirements;
  readonly sessionConfig: ProviderCreateConfig;
  readonly permissionPolicy: ProviderCreateConfig["permissionPolicy"];
  readonly permissionAgent?: string;
  readonly env: Record<string, string>;
  readonly sessionHooks: SessionHooks;
}

export interface RunSessionResult {
  readonly finalCostUsd: number;
  readonly sessionSucceeded: boolean;
  readonly lastError: string | null;
  readonly accumulatedText: string;
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly successfulProviderId?: ProviderId;
  readonly transcript: PersistedTranscriptEvent[];
}

export async function runSession(options: RunSessionOptions): Promise<RunSessionResult> {
  const governedContext = governSessionContext(options.context, options.permissionPolicy);
  const permissionEvaluator: PermissionEvaluator = createPermissionEvaluator(
    options.permissionPolicy,
    { agent: options.permissionAgent },
  );
  const selection = options.registry.selectBest(options.requirements);
  const candidates: ProviderId[] = [
    selection.primary,
    ...selection.orderedFallbacks,
  ];

  let finalCostUsd = 0;
  let sessionSucceeded = false;
  let lastError: string | null = null;
  let accumulatedText = "";
  let toolCallCount = 0;
  let turnDepth = 0;
  let successfulProviderId: ProviderId | undefined;
  const transcript: PersistedTranscriptEvent[] = [];
  let transcriptSeq = 0;
  let isFirstDeltaOfTurn = false;
  let awaitingTurnStart = true;
  let lastToolName: string | undefined;

  for (const providerId of candidates) {
    let isPreflightCrash = false;
    let providerDeniedByPolicy = false;

    const session = options.registry.createSession(providerId, options.sessionConfig);
    options.cleanupRegistry.register(async () => session.dispose());

    try {
      for await (const event of session.run({
        prompt: buildPreamble(governedContext, options.permissionPolicy, undefined),
        cwd: process.cwd(),
        env: options.env,
      })) {
        switch (event.type) {
          case "text_delta": {
            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: { type: "text_delta", content: event.content },
            });
            if (awaitingTurnStart) {
              turnDepth++;
              awaitingTurnStart = false;
            }
            if (isFirstDeltaOfTurn) {
              isFirstDeltaOfTurn = false;
              options.sessionHooks.userPromptSubmit();
            }
            process.stdout.write(event.content);
            accumulatedText += event.content;
            break;
          }
          case "tool_use": {
            const decision = permissionEvaluator.evaluateTool(event.toolName);
            if (decision.action === "deny") {
              transcript.push({
                seq: ++transcriptSeq,
                ts: new Date().toISOString(),
                event: { type: "tool_use", toolName: `${event.toolName} [DENIED]` },
              });
              lastError = `Provider ${providerId} denied tool "${event.toolName}" by policy`;
              options.registry.reportFailure(providerId, false);
              providerDeniedByPolicy = true;
              break;
            }

            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: { type: "tool_use", toolName: event.toolName },
            });
            console.log(`[tool] ${event.toolName}`);
            toolCallCount++;
            lastToolName = event.toolName;
            options.sessionHooks.preToolUse(event.toolName);
            break;
          }
          case "tool_result": {
            transcript.push({
              seq: ++transcriptSeq,
              ts: new Date().toISOString(),
              event: { type: "tool_result" },
            });
            isFirstDeltaOfTurn = true;
            awaitingTurnStart = true;
            if (lastToolName) {
              options.sessionHooks.postToolUse(lastToolName);
            }
            break;
          }
          case "cost_update": {
            finalCostUsd = event.usd;
            options.manager.trackCostUpdate(
              event.inputTokens ?? 0,
              event.outputTokens ?? 0,
              event.cacheReadTokens ?? 0,
              event.usd,
            );
            break;
          }
          case "completed": {
            isPreflightCrash = event.isPreflightCrash;
            if (event.isPreflightCrash) {
              lastError = `Provider ${providerId} crashed before starting`;
              options.registry.reportFailure(providerId, true);
              break;
            }
            if (event.isError) {
              lastError = `Provider ${providerId} ended with error`;
              options.registry.reportFailure(providerId, false);
              break;
            }
            sessionSucceeded = true;
            successfulProviderId = providerId;
            options.registry.reportSuccess(providerId);
            break;
          }
          case "error": {
            lastError = event.message;
            if (!event.isRetryable) {
              options.registry.reportFailure(providerId, false);
            }
            break;
          }
        }

        if (providerDeniedByPolicy) {
          break;
        }
      }
    } finally {
      options.cleanupRegistry.register(async () => session.dispose());
      await session.dispose();
    }

    if (sessionSucceeded) break;

    if (!isPreflightCrash && !sessionSucceeded) {
      console.error(`[kiln] Provider ${providerId} failed, trying next...`);
    }
  }

  return {
    finalCostUsd,
    sessionSucceeded,
    lastError,
    accumulatedText,
    toolCallCount,
    turnDepth,
    successfulProviderId,
    transcript,
  };
}
