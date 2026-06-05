import { pathToFileURL } from "node:url";

export const KILN_LIVE_MANAGED_AGENT_TESTS_ENV = "KILN_LIVE_MANAGED_AGENT_TESTS";
export const KILN_LIVE_CODEX_TESTS_ENV = "KILN_LIVE_CODEX_TESTS";
export const KILN_LIVE_CODEX_MODEL = "KILN_LIVE_CODEX_MODEL";
export const KILN_LIVE_OPENCODE_TESTS_ENV = "KILN_LIVE_OPENCODE_TESTS";
export const KILN_LIVE_OPENCODE_MODEL = "KILN_LIVE_OPENCODE_MODEL";
export const KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV = "KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS";
export const KILN_LIVE_OPENAI_DIRECT_TESTS_ENV = "KILN_LIVE_OPENAI_DIRECT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV = "KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS";
export const KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV = "KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS";

const PROVIDER_FLAGS = [
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

export interface ManagedAgentLivePreflightResult {
  readonly ok: boolean;
  readonly enabledProviders: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly message: string;
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
  const autoDetectedProviders = uniqueProviderFlags(detectedProviderFlags);
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
