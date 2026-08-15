import type { GlobalConfigMutationOptions, GlobalConfigMutationResult, KilnGlobalConfig } from "../config/global-config.js";
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
  readonly mutateGlobalConfig: (
    mutation: (current: KilnGlobalConfig | null) => KilnGlobalConfig,
    options: GlobalConfigMutationOptions,
  ) => GlobalConfigMutationResult;
  readonly refreshExecutionRoutes: ExecutionRouteRefreshPort;
}): Promise<ExecutionRouteCreationCommitResult> {
  const result = input.mutateGlobalConfig((current) => {
    if (!current?.targetCatalog) throw new Error("Global config must declare targetCatalog before creating a direct target.");
    return {
      ...current,
      targetCatalog: {
        ...current.targetCatalog,
        targets: [...current.targetCatalog.targets, { ...input.draft.route, kind: "direct" as const }],
      },
    };
  }, { expectedRevision: input.expectedRevision });
  try {
    await input.refreshExecutionRoutes();
    return { ...result, status: "created" };
  } catch {
    return { ...result, status: "committed-refresh-failed" };
  }
}
