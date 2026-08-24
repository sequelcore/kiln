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
export const KILN_LIVE_OPENAI_DIRECT_MODEL = "KILN_LIVE_OPENAI_DIRECT_MODEL";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV = "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL = "KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV = "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS";
export const KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV =
  "KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV =
  "KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE";

export const MANAGED_AGENT_LIVE_CONFIGURATION_FLAGS = [
  KILN_LIVE_CODEX_MODEL,
  KILN_LIVE_CLAUDE_MODEL,
  KILN_LIVE_OPENCODE_MODEL,
  KILN_LIVE_OPENAI_DIRECT_MODEL,
  KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
] as const;

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
): ManagedAgentLivePreflightResult {
  for (const flag of [KILN_LIVE_MANAGED_AGENT_TESTS_ENV, ...PROVIDER_FLAGS]) {
    if (Object.hasOwn(env, flag) && env[flag] !== "0" && env[flag] !== "1") {
      return {
        ok: false,
        enabledProviders: [],
        environment: {},
        message: `Managed-agent live preflight flag ${flag} must be exactly 0 or 1.`,
      };
    }
  }
  if (env[KILN_LIVE_MANAGED_AGENT_TESTS_ENV] !== "1") {
    return {
      ok: false,
      enabledProviders: [],
      environment: {},
      message: [
        "Managed-agent live proof requires explicit authority.",
        `Set ${KILN_LIVE_MANAGED_AGENT_TESTS_ENV}=1 and at least one provider flag to 1; executable or credential discovery never authorizes live proof.`,
      ].join(" "),
    };
  }

  const explicitProviders = PROVIDER_FLAGS.filter((flag) => env[flag] === "1");
  if (explicitProviders.length === 0) {
    return {
      ok: false,
      enabledProviders: [],
      environment: {},
      message: [
        "Managed-agent live proof has no explicitly enabled provider authority.",
        `Set at least one provider flag to 1: ${PROVIDER_FLAGS.join(", ")}.`,
      ].join(" "),
    };
  }

  const enabledProviders = explicitProviders;

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
    [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV, KILN_LIVE_OPENAI_DIRECT_MODEL],
    [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL],
    [KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL],
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

  if (enabledProviders.includes(KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV)) {
    if (!enabledProviders.includes(KILN_LIVE_OPENCODE_TESTS_ENV)) {
      return {
        ok: false,
        enabledProviders,
        environment: {},
        message: `${KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV} requires ${KILN_LIVE_OPENCODE_TESTS_ENV}=1; the write subproof cannot authorize the base route itself.`,
      };
    }
    if (!env[KILN_LIVE_OPENCODE_MODEL]?.trim()) {
      return {
        ok: false,
        enabledProviders,
        environment: {},
        message: `${KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV} requires ${KILN_LIVE_OPENCODE_MODEL} to name an explicit exact model.`,
      };
    }
  }

  for (const [providerFlag, routeVariable] of [
    [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV, KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV],
    [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV],
  ] as const) {
    if (enabledProviders.includes(providerFlag) && !env[routeVariable]?.trim()) {
      return {
        ok: false,
        enabledProviders,
        environment: {},
        message: `${providerFlag} requires ${routeVariable} to name an explicit authorized route.`,
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
