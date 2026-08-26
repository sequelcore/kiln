import type { QualityAnalyzeToolOptions } from "@kilnai/core";
import { RUNNING_CLI_VERSION } from "../../build-identity.js";
import type { KilnGlobalConfig } from "../global-config.js";

export interface QualityAnalysisConfigurationResolution {
  readonly options?: QualityAnalyzeToolOptions;
  readonly diagnostic?: { readonly code: "not_configured"; readonly message: string };
}

export function resolveQualityAnalysisConfiguration(
  globalConfig?: KilnGlobalConfig | null,
): QualityAnalysisConfigurationResolution {
  const profiles = globalConfig?.verification?.static?.quality?.typescript;
  if (profiles === undefined) {
    return {
      diagnostic: {
        code: "not_configured",
        message: "TypeScript quality analysis is not configured in the operator global config.",
      },
    };
  }
  return { options: { profiles: ["type-integrity"], analyzerVersion: RUNNING_CLI_VERSION } };
}
