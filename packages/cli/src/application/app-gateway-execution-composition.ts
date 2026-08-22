import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExecutionCatalog } from "@kilnai/core";
import { parseGatewayYaml, parseRuntimeModeConfig } from "@kilnai/core";
import {
  ConfiguredExecutionAccountRuntime,
  createOperatorSessionAccountCapacityAuthority,
  type AppGatewayExecutionBundle,
  type OperatorSessionExecutionCatalogSnapshot,
  type StartGatewayOptions,
} from "@kilnai/runtime";
import { readGlobalConfigSnapshot, readGlobalExecutionCatalog } from "../config/global-config.js";
import { createRuntimeConfigurationRevisionSetId, readRuntimeConfigurationRevision } from "./runtime-configuration-revision.js";
import { captureOperatorExecutionCatalogSnapshot } from "./operator-turn-dispatch-composition.js";
import { TranscriptAuthorityAdmissionEvidenceStore } from "./authority-admission-evidence-store.js";
import { TranscriptStore } from "../wrapper/session-store.js";
import { canonicalSessionEventsFromTranscript } from "./runtime-session-rehydration.js";
import { toCanonicalSessionEventPersistedTranscriptEventDraft } from "./operator-transcript-projection.js";
import {
  createCliTranscriptSessionTokenUsageReader,
  createRuntimeSessionTurnBudgetFromGlobalConfig,
} from "./session-turn-budget.js";

export interface AppGatewayExecutionComposition {
  readonly bundle: AppGatewayExecutionBundle;
  readonly close: () => void;
  readonly replayCanonicalSessionEvents: (sessionId: string) => Promise<ReturnType<typeof canonicalSessionEventsFromTranscript>>;
}

/** Returns whether a gateway config declares at least one provider-adapter App. */
export function gatewayRequiresAppGatewayExecution(configPath: string): boolean {
  const config = parseGatewayYaml(readFileSync(configPath, "utf8"));
  return config.apps.some((binding) => {
    try {
      return parseRuntimeModeConfig(readFileSync(join(dirname(configPath), binding.config), "utf8"))?.runtime === "provider-adapter";
    } catch {
      return false;
    }
  });
}

/**
 * Composes the physical CLI adapters required by Runtime's provider-adapter
 * gateway. The catalog and revision are captured together before any account
 * authority is opened, so startup cannot invent a target or admit stale bytes.
 */
export function createAppGatewayExecutionComposition(input: {
  readonly projectPath: string;
  readonly configPath: string;
  readonly captureCatalogSnapshot?: () => OperatorSessionExecutionCatalogSnapshot;
  readonly readGlobalConfigSnapshot?: typeof readGlobalConfigSnapshot;
}): AppGatewayExecutionComposition {
  const globalConfigSnapshot = (input.readGlobalConfigSnapshot ?? readGlobalConfigSnapshot)();
  const snapshot = captureCompleteAppGatewaySnapshot(input, globalConfigSnapshot);
  if (!snapshot.catalog) {
    throw new Error("App Gateway execution requires an admitted canonical execution catalog.");
  }

  mkdirSync(join(input.projectPath, ".kiln", "runtime"), { recursive: true });
  const capacityAuthority = createOperatorSessionAccountCapacityAuthority({
    path: join(input.projectPath, ".kiln", "runtime", "operator-session-account-capacity.sqlite"),
    configurationRevision: snapshot.configurationRevision.revisionSetId,
  });
  const accountRuntime = new ConfiguredExecutionAccountRuntime({
    catalog: snapshot.catalog,
    observeOperatorSessionCapacity: (candidates) => capacityAuthority.observeCandidateCapacity(candidates),
  });
  const transcriptStore = new TranscriptStore(input.projectPath);
  const sessionTurnBudget = createRuntimeSessionTurnBudgetFromGlobalConfig(
    globalConfigSnapshot.config,
    createCliTranscriptSessionTokenUsageReader(transcriptStore),
  );
  const evidenceStore = new TranscriptAuthorityAdmissionEvidenceStore(transcriptStore);
  const persistOperatorAdoptionDecision = async (event: Parameters<NonNullable<StartGatewayOptions["appGatewayExecution"]>["persistOperatorAdoptionDecision"]>[0]): Promise<void> => {
    await transcriptStore.appendManyNext(
      event.kilnSessionId,
      [toCanonicalSessionEventPersistedTranscriptEventDraft(event)],
    );
  };
  const close = (): void => capacityAuthority.close();

  return {
    bundle: {
      snapshot,
      accountRuntime,
      accountCapacityAuthority: capacityAuthority,
      evidenceStore,
      persistOperatorAdoptionDecision,
      ...(sessionTurnBudget ? { sessionTurnBudget } : {}),
      close,
    },
    close,
    replayCanonicalSessionEvents: async (sessionId) => canonicalSessionEventsFromTranscript(
      await transcriptStore.readTranscript(sessionId),
      sessionId,
    ),
  };
}

function captureCompleteAppGatewaySnapshot(
  input: {
    readonly projectPath: string;
    readonly configPath: string;
    readonly captureCatalogSnapshot?: () => OperatorSessionExecutionCatalogSnapshot;
  },
  globalConfigSnapshot: ReturnType<typeof readGlobalConfigSnapshot>,
): OperatorSessionExecutionCatalogSnapshot {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = readAppGatewayRevisionFamilies(input.configPath);
    const base = input.captureCatalogSnapshot?.() ?? captureOperatorExecutionCatalogSnapshot({
      projectPath: input.projectPath,
      readConfigSnapshot: () => globalConfigSnapshot,
      readConfigurationRevision: readRuntimeConfigurationRevision,
      readExecutionCatalog: (config): ExecutionCatalog => {
        const catalog = readGlobalExecutionCatalog(config);
        if (!catalog) throw new Error("App Gateway execution requires an admitted canonical execution catalog.");
        return catalog;
      },
    });
    const second = readAppGatewayRevisionFamilies(input.configPath);
    if (JSON.stringify(first) !== JSON.stringify(second)) continue;
    const revisions = { ...base.configurationRevision.revisions, ...first };
    return {
      catalog: base.catalog,
      configurationRevision: {
        revisionSetId: createRuntimeConfigurationRevisionSetId(revisions),
        revisions,
        ...(base.configurationRevision.activationLineage
          ? { activationLineage: base.configurationRevision.activationLineage }
          : {}),
      },
    };
  }
  throw new Error("App Gateway configuration changed during Runtime revision admission.");
}

function readAppGatewayRevisionFamilies(configPath: string): Readonly<Record<string, string>> {
  const gatewayBytes = readFileSync(configPath, "utf8");
  const gateway = parseGatewayYaml(gatewayBytes);
  const revisions: Record<string, string> = {
    "app-gateway:gateway": digest(gatewayBytes),
  };
  for (const binding of [...gateway.apps].sort((left, right) => left.name.localeCompare(right.name))) {
    revisions[`app-gateway:app:${binding.name}`] = digest(readFileSync(join(dirname(configPath), binding.config), "utf8"));
  }
  return revisions;
}

function digest(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
