import type { GlobalConfigMutationOptions, GlobalConfigMutationResult, KilnGlobalConfig } from "../config/global-config.js";
import {
  defineExecutionTargetEvidenceSnapshot,
  executionTargetEvidenceRevision,
  projectExecutionCatalogFromIntent,
  writeExecutionTargetEvidenceSnapshot,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import { resolveGlobalConfigPath } from "../config/global-config.js";
import type { CompleteExecutionRouteDraft } from "./execution-route-draft.js";

export interface ExecutionRouteRefreshPort {
  (): Promise<void>;
}

export type ExecutionRouteCreationCommitResult = GlobalConfigMutationResult & {
  readonly status: "created" | "committed-refresh-failed";
};

export async function createExecutionRoute(input: {
  readonly draft: CompleteExecutionRouteDraft;
  readonly expectedRevision: string;
  readonly currentIntent: ExecutionTargetCatalogIntent;
  readonly currentEvidence: ExecutionTargetEvidenceSnapshot;
  readonly mutateGlobalConfig: (
    mutation: (current: KilnGlobalConfig | null) => KilnGlobalConfig,
    options: GlobalConfigMutationOptions,
  ) => GlobalConfigMutationResult;
  readonly publishEvidence?: typeof writeExecutionTargetEvidenceSnapshot;
  readonly globalConfigPath?: string;
  readonly refreshExecutionRoutes: ExecutionRouteRefreshPort;
}): Promise<ExecutionRouteCreationCommitResult> {
  const nextEvidence = defineExecutionTargetEvidenceSnapshot({
    ...input.currentEvidence,
    targets: [...input.currentEvidence.targets, input.draft.evidence],
  });
  const nextEvidenceRevision = executionTargetEvidenceRevision(nextEvidence);
  const nextIntent: ExecutionTargetCatalogIntent = {
    ...input.currentIntent,
    evidenceRevision: nextEvidenceRevision,
    targets: [...input.currentIntent.targets, input.draft.intent],
  };
  projectExecutionCatalogFromIntent(nextIntent, nextEvidence, nextEvidenceRevision);
  const published = (input.publishEvidence ?? writeExecutionTargetEvidenceSnapshot)({
    globalConfigPath: input.globalConfigPath ?? resolveGlobalConfigPath(),
    snapshot: nextEvidence,
  });
  if (published.revision !== nextEvidenceRevision) {
    throw new Error("Published execution-target evidence revision changed after validation.");
  }
  const result = input.mutateGlobalConfig((current) => {
    if (!current?.targetCatalog) throw new Error("Global config must declare targetCatalog before creating a direct target.");
    if (current.targetCatalog.evidenceRevision !== input.currentIntent.evidenceRevision) {
      throw new Error("Execution-target managed evidence changed before target publication.");
    }
    return {
      ...current,
      targetCatalog: nextIntent,
    };
  }, { expectedRevision: input.expectedRevision });
  try {
    await input.refreshExecutionRoutes();
    return { ...result, status: "created" };
  } catch {
    return { ...result, status: "committed-refresh-failed" };
  }
}
