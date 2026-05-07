export const HARNESSES_WITH_NATIVE_PROJECTION = ["claude", "codex", "opencode"] as const;

export type HarnessIntegrationId = typeof HARNESSES_WITH_NATIVE_PROJECTION[number];

export const HARNESSES_WITH_NATIVE_CONFIG_IMPORT = ["codex", "opencode"] as const satisfies readonly HarnessIntegrationId[];

export type HarnessIntegrationMechanism =
  | "runtimeConfigInjection"
  | "nativeProjection"
  | "nativeConfigImport"
  | "pluginPackaging"
  | "mcpRuntimeTools"
  | "hooks";

export interface RuntimeConfigInjectionCapability {
  readonly supported: boolean;
  readonly mechanism?: string;
  readonly scope?: "kiln-launched-process";
}

export interface NativeProjectionCapability {
  readonly supported: boolean;
  readonly requiredForStandalone: boolean;
  readonly managedByInstallState: boolean;
}

export interface HarnessIntegrationCapability {
  readonly harness: HarnessIntegrationId;
  readonly displayName: "Claude Code" | "Codex" | "OpenCode";
  readonly runtimeConfigInjection: RuntimeConfigInjectionCapability;
  readonly nativeProjection: NativeProjectionCapability;
  readonly nativeConfigImport: boolean;
  readonly pluginPackaging: boolean;
  readonly mcpRuntimeTools: boolean;
  readonly hooks: boolean;
}

const NATIVE_PROJECTION_CAPABILITY: NativeProjectionCapability = {
  supported: true,
  requiredForStandalone: true,
  managedByInstallState: true,
};

function supportsNativeConfigImport(harness: HarnessIntegrationId): boolean {
  return HARNESSES_WITH_NATIVE_CONFIG_IMPORT.includes(
    harness as typeof HARNESSES_WITH_NATIVE_CONFIG_IMPORT[number],
  );
}

const HARNESS_INTEGRATION_CAPABILITIES: Record<HarnessIntegrationId, HarnessIntegrationCapability> = {
  claude: {
    harness: "claude",
    displayName: "Claude Code",
    runtimeConfigInjection: { supported: false },
    nativeProjection: NATIVE_PROJECTION_CAPABILITY,
    nativeConfigImport: supportsNativeConfigImport("claude"),
    pluginPackaging: true,
    mcpRuntimeTools: true,
    hooks: true,
  },
  codex: {
    harness: "codex",
    displayName: "Codex",
    runtimeConfigInjection: {
      supported: true,
      mechanism: "CODEX_HOME + CLI config overrides",
      scope: "kiln-launched-process",
    },
    nativeProjection: NATIVE_PROJECTION_CAPABILITY,
    nativeConfigImport: supportsNativeConfigImport("codex"),
    pluginPackaging: true,
    mcpRuntimeTools: true,
    hooks: true,
  },
  opencode: {
    harness: "opencode",
    displayName: "OpenCode",
    runtimeConfigInjection: {
      supported: true,
      mechanism: "OPENCODE_CONFIG_CONTENT",
      scope: "kiln-launched-process",
    },
    nativeProjection: NATIVE_PROJECTION_CAPABILITY,
    nativeConfigImport: supportsNativeConfigImport("opencode"),
    pluginPackaging: true,
    mcpRuntimeTools: true,
    hooks: true,
  },
};

export function listHarnessIntegrationCapabilities(): readonly HarnessIntegrationCapability[] {
  return HARNESSES_WITH_NATIVE_PROJECTION.map((harness) => HARNESS_INTEGRATION_CAPABILITIES[harness]);
}

export function getHarnessIntegrationCapability(harness: HarnessIntegrationId): HarnessIntegrationCapability {
  return HARNESS_INTEGRATION_CAPABILITIES[harness];
}

export function supportsHarnessIntegration(
  harness: HarnessIntegrationId,
  mechanism: HarnessIntegrationMechanism,
): boolean {
  const capability = getHarnessIntegrationCapability(harness);
  if (mechanism === "runtimeConfigInjection") {
    return capability.runtimeConfigInjection.supported;
  }
  if (mechanism === "nativeProjection") {
    return capability.nativeProjection.supported;
  }
  return capability[mechanism];
}
