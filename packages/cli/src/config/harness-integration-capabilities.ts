import {
  getManagedAgentCrossHarnessInvocationCapability,
  type ManagedAgentCrossHarnessAdapterId,
} from "@kilnai/core";

export const HARNESSES_WITH_NATIVE_PROJECTION = ["claude", "codex", "opencode"] as const;

export type HarnessIntegrationId = typeof HARNESSES_WITH_NATIVE_PROJECTION[number];

export const HARNESSES_WITH_NATIVE_CONFIG_IMPORT = ["codex", "opencode"] as const satisfies readonly HarnessIntegrationId[];

export type HarnessIntegrationMechanism =
  | "runtimeConfigInjection"
  | "nativeProjection"
  | "nativeConfigImport"
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

export interface CrossHarnessManagedInvocationCapability {
  readonly adapterId: ManagedAgentCrossHarnessAdapterId;
  readonly supportedProviderIds: readonly string[];
}

export type NativeAgentModelEncoder = (model: string) => string;

export type HarnessRouteCapability =
  | {
    readonly kind: "native-supported";
    readonly harness: HarnessIntegrationId;
    readonly providerId: string;
    readonly model: string;
    readonly nativeModel: string;
  }
  | {
    readonly kind: "adapter-supported";
    readonly harness: HarnessIntegrationId;
    readonly providerId: string;
    readonly model: string;
    readonly adapterId: "kiln-managed-invocation";
    readonly reason: "cross-harness-managed-invocation";
  }
  | {
    readonly kind: "unsupported";
    readonly harness: HarnessIntegrationId;
    readonly providerId: string;
    readonly model?: string;
    readonly reason: "missing-model" | "unsupported-provider";
  };

export interface HarnessIntegrationCapability {
  readonly harness: HarnessIntegrationId;
  readonly displayName: "Claude Code" | "Codex" | "OpenCode";
  readonly runtimeConfigInjection: RuntimeConfigInjectionCapability;
  readonly nativeProjection: NativeProjectionCapability;
  readonly nativeConfigImport: boolean;
  readonly mcpRuntimeTools: boolean;
  readonly hooks: boolean;
  readonly crossHarnessManagedInvocation: CrossHarnessManagedInvocationCapability;
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
    mcpRuntimeTools: true,
    hooks: true,
    crossHarnessManagedInvocation: getManagedAgentCrossHarnessInvocationCapability("claude"),
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
    mcpRuntimeTools: true,
    hooks: true,
    crossHarnessManagedInvocation: getManagedAgentCrossHarnessInvocationCapability("codex"),
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
    mcpRuntimeTools: true,
    hooks: true,
    crossHarnessManagedInvocation: getManagedAgentCrossHarnessInvocationCapability("opencode"),
  },
};

const NATIVE_AGENT_MODEL_ENCODERS: Record<
  HarnessIntegrationId,
  Readonly<Record<string, NativeAgentModelEncoder>>
> = {
  claude: {},
  codex: {
    "codex-oauth": (model) => model,
  },
  opencode: {
    "opencode-go": (model) => `opencode-go/${model}`,
    "opencode-zen": (model) => `opencode/${model}`,
    openrouter: (model) => `openrouter/${model}`,
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

export function encodeNativeAgentModel(
  harness: HarnessIntegrationId,
  providerId: string,
  model: string,
): string | undefined {
  const encoder = NATIVE_AGENT_MODEL_ENCODERS[harness][providerId];
  return encoder ? encoder(model) : undefined;
}

export function resolveHarnessRouteCapability(input: {
  readonly harness: HarnessIntegrationId;
  readonly providerId: string;
  readonly model?: string;
}): HarnessRouteCapability {
  const providerId = input.providerId.trim();
  const model = input.model?.trim();
  if (!model) {
    return {
      kind: "unsupported",
      harness: input.harness,
      providerId,
      reason: "missing-model",
    };
  }

  const nativeModel = encodeNativeAgentModel(input.harness, providerId, model);
  if (nativeModel) {
    return {
      kind: "native-supported",
      harness: input.harness,
      providerId,
      model,
      nativeModel,
    };
  }

  if (getHarnessIntegrationCapability(input.harness).crossHarnessManagedInvocation.supportedProviderIds.includes(providerId)) {
    return {
      kind: "adapter-supported",
      harness: input.harness,
      providerId,
      model,
      adapterId: "kiln-managed-invocation",
      reason: "cross-harness-managed-invocation",
    };
  }

  return {
    kind: "unsupported",
    harness: input.harness,
    providerId,
    model,
    reason: "unsupported-provider",
  };
}
