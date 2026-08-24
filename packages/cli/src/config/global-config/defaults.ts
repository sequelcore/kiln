import { DEFAULT_WORK_GOVERNANCE_CONFIG } from "../../kiln-yaml-types.js";
import {
  CANONICAL_GLOBAL_CONFIG_VERSION,
  type KilnGlobalConfig,
  type KilnGlobalUiAppearance,
} from "../global-config-schema.js";

export function defaultGlobalConfig(): KilnGlobalConfig {
  return {
    version: CANONICAL_GLOBAL_CONFIG_VERSION,
    engines: {
      claude: { enabled: true, billing: "subscription" },
      codex: { enabled: false, billing: "plus-quota" },
      opencode: { enabled: false, billing: "free" },
    },
    permissions: {
      approval: "on-request",
      sandbox: "read-only",
    },
    permissionCeiling: {
      approval: "on-request",
      sandbox: "workspace-write",
    },
    ui: {
      appearance: {
        mode: "system",
        themeByScheme: {
          light: "automata",
          dark: "phosphor",
        },
      },
    },
    skills: {
      builtin: {
        enabled: true,
      },
    },
    workGovernance: DEFAULT_WORK_GOVERNANCE_CONFIG,
    components: {
      include: ["baseline:core"],
    },
  };
}

export function resolveGlobalDefaultProvider(config: KilnGlobalConfig | null | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const targetId = config.targetRouting?.defaultTargetId;
  return config.targetCatalog?.targets.find((target) => target.id === targetId)?.providerId;
}

export function resolveGlobalDefaultModel(config: KilnGlobalConfig | null | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const targetId = config.targetRouting?.defaultTargetId;
  return config.targetCatalog?.targets.find((target) => target.id === targetId)?.providerModelId;
}

export function resolveGlobalUiAppearance(config: KilnGlobalConfig | null | undefined): KilnGlobalUiAppearance | undefined {
  return config?.ui?.appearance;
}
