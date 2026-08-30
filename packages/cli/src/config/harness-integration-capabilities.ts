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
  readonly requiredForDisconnectedContinuity: boolean;
  readonly managedByInstallState: boolean;
  readonly disconnectedContinuity: {
    readonly instructions: "self-contained-guidance";
    readonly skills: "self-contained-discovery";
    readonly enforcement: "not-provided";
  };
}

export type NativeAgentModelEncoder = (model: string) => string;

export interface HarnessIntegrationCapability {
  readonly harness: HarnessIntegrationId;
  readonly displayName: "Claude Code" | "Codex" | "OpenCode";
  readonly runtimeConfigInjection: RuntimeConfigInjectionCapability;
  readonly nativeProjection: NativeProjectionCapability;
  readonly nativeConfigImport: boolean;
  readonly mcpRuntimeTools: boolean;
  readonly hooks: boolean;
  /**
   * Whether the selected native route can enforce these scalar constraints
   * before the provider is allowed to perform work.  Prompt constraints and
   * post-hoc observations are deliberately not counted here.
   */
  readonly preventiveEnforcement: {
    readonly approval: boolean;
    readonly sandbox: boolean;
  };
}

const NATIVE_PROJECTION_CAPABILITY: NativeProjectionCapability = {
  supported: true,
  requiredForDisconnectedContinuity: true,
  managedByInstallState: true,
  disconnectedContinuity: {
    instructions: "self-contained-guidance",
    skills: "self-contained-discovery",
    enforcement: "not-provided",
  },
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
    preventiveEnforcement: { approval: true, sandbox: false },
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
    preventiveEnforcement: { approval: true, sandbox: true },
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
    preventiveEnforcement: { approval: true, sandbox: false },
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

export type PreventiveRouteId = HarnessIntegrationId | "direct-provider";

export interface PreventivePermissionTranslationRule {
  readonly category: string;
  readonly selector: string;
  readonly action: string;
  readonly reason?: string;
}

export interface PreventiveRouteAdmissionInput {
  readonly route: PreventiveRouteId;
  readonly sandbox: string | undefined;
  readonly approval: string | undefined;
  readonly representableRules: readonly PreventivePermissionTranslationRule[];
  readonly unsupportedRules: readonly PreventivePermissionTranslationRule[];
}

export interface PreventiveRouteAdmission {
  readonly admitted: boolean;
  readonly rejectedRules: readonly PreventivePermissionTranslationRule[];
  readonly rejectedCapabilities: readonly ("approval" | "sandbox")[];
  readonly reason?: string;
}

/**
 * Rejects a route when a configured restriction would only be conveyed as
 * prompt text or observed after the provider acted.  This is intentionally a
 * narrow admission check over the existing translation envelope, not a second
 * permission evaluator.
 */
export function admitPreventiveRoute(
  input: PreventiveRouteAdmissionInput,
): PreventiveRouteAdmission {
  const capability = input.route === "direct-provider"
    ? { approval: true, sandbox: false }
    : getHarnessIntegrationCapability(input.route).preventiveEnforcement;
  const rejectedRules = input.unsupportedRules.filter((rule) => {
    const action = rule.action.toLowerCase();
    // Unsupported allows do not constrain a route and therefore do not make
    // it unsafe to launch. Every restrictive declaration must be prevented.
    if (action === "allow" || action === "inherit") return false;
    return action !== "neutral";
  });
  const rejectedCapabilities: ("approval" | "sandbox")[] = [];
  if (input.approval !== undefined && input.approval !== "never" && !capability.approval) {
    rejectedCapabilities.push("approval");
  }
  if (input.sandbox !== undefined && !capability.sandbox) {
    rejectedCapabilities.push("sandbox");
  }
  const reasons = [
    ...rejectedCapabilities.map((dimension) => `${dimension} is not preventively enforced by ${input.route}`),
    ...rejectedRules.map((rule) =>
      `unsupported ${rule.category} ${rule.action} rule '${rule.selector}' would rely on prompt or post-hoc observation`,
    ),
  ];
  return {
    admitted: reasons.length === 0,
    rejectedRules,
    rejectedCapabilities,
    ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}),
  };
}
