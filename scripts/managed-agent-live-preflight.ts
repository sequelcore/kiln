import { pathToFileURL } from "node:url";

export const KILN_LIVE_MANAGED_AGENT_TESTS_ENV = "KILN_LIVE_MANAGED_AGENT_TESTS";
export const KILN_LIVE_CODEX_TESTS_ENV = "KILN_LIVE_CODEX_TESTS";
export const KILN_LIVE_CLAUDE_TESTS_ENV = "KILN_LIVE_CLAUDE_TESTS";
export const KILN_LIVE_CLAUDE_MODEL = "KILN_LIVE_CLAUDE_MODEL";
export const KILN_LIVE_CODEX_MODEL = "KILN_LIVE_CODEX_MODEL";
export const KILN_LIVE_OPENCODE_TESTS_ENV = "KILN_LIVE_OPENCODE_TESTS";
export const KILN_LIVE_OPENCODE_MODEL = "KILN_LIVE_OPENCODE_MODEL";
export const KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV = "KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS";
export const KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV = "KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS";
export const KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV = "KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE";
export const KILN_LIVE_OPENAI_DIRECT_TESTS_ENV = "KILN_LIVE_OPENAI_DIRECT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV = "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV = "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS";
export const KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV =
  "KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV =
  "KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE";

const CLAUDE_NON_ENTITLEMENT_ENVIRONMENT = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

const PROVIDER_FLAGS = [
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
] as const;

const AUTO_DETECTABLE_PROVIDER_FLAGS = new Set<string>(
  PROVIDER_FLAGS.filter((flag) => flag !== KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV),
);

type Environment = Readonly<Record<string, string | undefined>>;

export interface ManagedAgentLivePreflightResult {
  readonly ok: boolean;
  readonly enabledProviders: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly message: string;
}

/** Keeps the Claude live proof on the operator's native claude.ai entitlement. */
export function projectClaudeNativeEntitlementEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const projected = { ...env };
  for (const name of CLAUDE_NON_ENTITLEMENT_ENVIRONMENT) delete projected[name];
  return projected;
}

export function evaluateManagedAgentLivePreflight(
  env: Environment = process.env,
  detectedProviderFlags: readonly string[] = [],
): ManagedAgentLivePreflightResult {
  if (env[KILN_LIVE_MANAGED_AGENT_TESTS_ENV] === "0") {
    return {
      ok: false,
      enabledProviders: [],
      environment: {},
      message: [
        "Managed-agent live proof is explicitly disabled.",
        `${KILN_LIVE_MANAGED_AGENT_TESTS_ENV}=0 prevents auto-detected live providers from running.`,
      ].join(" "),
    };
  }

  const explicitProviders = PROVIDER_FLAGS.filter((flag) => env[flag] === "1");
  const autoDetectedProviders = uniqueProviderFlags(
    detectedProviderFlags.filter((flag) => AUTO_DETECTABLE_PROVIDER_FLAGS.has(flag)),
  );
  const enabledProviders = explicitProviders.length > 0 ? explicitProviders : autoDetectedProviders;
  if (env[KILN_LIVE_MANAGED_AGENT_TESTS_ENV] !== "1" && enabledProviders.length === 0) {
    return {
      ok: false,
      enabledProviders: [],
      environment: {},
      message: [
        "Managed-agent live proof has no enabled or auto-detected provider route.",
        `Set ${KILN_LIVE_MANAGED_AGENT_TESTS_ENV}=1 and at least one provider flag to run live proof,`,
        "or install and authenticate a supported local harness.",
        `Provider flags: ${PROVIDER_FLAGS.join(", ")}.`,
        "Use bun run test:harness for deterministic non-live harness coverage.",
      ].join(" "),
    };
  }

  if (enabledProviders.length === 0) {
    return {
      ok: false,
      enabledProviders,
      environment: {},
      message: [
        "Managed-agent live proof has no enabled provider route.",
        `Set at least one provider flag to 1: ${PROVIDER_FLAGS.join(", ")}.`,
      ].join(" "),
    };
  }

  if (enabledProviders.includes(KILN_LIVE_CLAUDE_TESTS_ENV)) {
    const model = env[KILN_LIVE_CLAUDE_MODEL]?.trim();
    if (!model || ["default", "sonnet", "opus", "haiku"].includes(model)) {
      return {
        ok: false,
        enabledProviders,
        environment: {},
        message: `${KILN_LIVE_CLAUDE_MODEL} must name an explicit exact Claude catalog model for the authorized live proof.`,
      };
    }
  }

  for (const [providerFlag, modelVariable] of [
    [KILN_LIVE_CODEX_TESTS_ENV, KILN_LIVE_CODEX_MODEL],
    [KILN_LIVE_OPENCODE_TESTS_ENV, KILN_LIVE_OPENCODE_MODEL],
  ] as const) {
    if (enabledProviders.includes(providerFlag) && !env[modelVariable]?.trim()) {
      return {
        ok: false,
        enabledProviders,
        environment: {},
        message: `${modelVariable} must name an explicit exact model for the authorized live proof.`,
      };
    }
  }

  return {
    ok: true,
    enabledProviders,
    environment: {
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      ...Object.fromEntries(enabledProviders.map((flag) => [flag, "1"])),
    },
    message: `Managed-agent live proof enabled for: ${enabledProviders.join(", ")}.`,
  };
}

function uniqueProviderFlags(flags: readonly string[]): readonly string[] {
  const allowed = new Set(PROVIDER_FLAGS);
  return Array.from(new Set(flags.filter((flag) => allowed.has(flag as (typeof PROVIDER_FLAGS)[number]))));
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  const result = evaluateManagedAgentLivePreflight();
  const write = result.ok ? console.log : console.error;
  write(result.message);
  process.exitCode = result.ok ? 0 : 1;
}
