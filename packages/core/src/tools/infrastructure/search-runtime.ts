import type { BinaryInfo, ToolEnvironment } from "../domain/tool-environment.js";
import type { CommandResult } from "./tool-helpers.js";

export type SearchRuntimeSource = "bundled" | "configured" | "system";

export interface RipgrepRuntime {
  readonly path: string;
  readonly version: string;
  readonly source: SearchRuntimeSource;
}

type SearchRuntimeCommandRunner = (
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<CommandResult>;

type EnvironmentProvider = () => Promise<ToolEnvironment>;
export type VendoredToolResolver = (binary: "rg" | "fd" | "jq") => { readonly path: string; readonly version?: string } | undefined;

export interface RipgrepRuntimeProviderOptions {
  readonly bundledPath?: string;
  readonly configuredPath?: string;
  readonly commandRunner?: SearchRuntimeCommandRunner;
  readonly environmentProvider?: EnvironmentProvider;
  readonly vendoredToolResolver?: VendoredToolResolver;
  readonly cwd?: string;
  readonly verificationTimeoutMs?: number;
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 1_500;

export function createRipgrepRuntimeProvider(
  options: RipgrepRuntimeProviderOptions,
): () => Promise<RipgrepRuntime | undefined> {
  return async () => resolveRipgrepRuntime(options);
}

export async function resolveRipgrepRuntime(
  options: RipgrepRuntimeProviderOptions = {},
): Promise<RipgrepRuntime | undefined> {
  const cwd = options.cwd ?? ".";
  const timeoutMs = options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  const commandRunner = options.commandRunner ?? unavailableSearchCommandRunner;
  if (options.bundledPath) {
    return verifyRipgrep(options.bundledPath, "bundled", commandRunner, cwd, timeoutMs);
  }

  const vendoredToolResolver = options.vendoredToolResolver ?? noVendoredTool;
  const vendoredRipgrep = vendoredToolResolver("rg");
  if (vendoredRipgrep) {
    return verifyRipgrep(vendoredRipgrep.path, "bundled", commandRunner, cwd, timeoutMs);
  }

  if (options.configuredPath) {
    return verifyRipgrep(options.configuredPath, "configured", commandRunner, cwd, timeoutMs);
  }

  const environment = await (options.environmentProvider ?? emptyToolEnvironment)();
  return environment.rg ? fromBinaryInfo(environment.rg, "system") : undefined;
}

const unavailableSearchCommandRunner: SearchRuntimeCommandRunner = async () => {
  throw new Error("Search execution requires a Runtime-owned command runner");
};

const noVendoredTool: VendoredToolResolver = () => undefined;
const emptyToolEnvironment: EnvironmentProvider = async () => ({});

function fromBinaryInfo(binary: BinaryInfo, source: SearchRuntimeSource): RipgrepRuntime {
  return {
    path: binary.path,
    version: binary.version,
    source,
  };
}

async function verifyRipgrep(
  path: string,
  source: SearchRuntimeSource,
  commandRunner: SearchRuntimeCommandRunner,
  cwd: string,
  timeoutMs: number,
): Promise<RipgrepRuntime> {
  const result = await commandRunner(path, ["--version"], cwd, timeoutMs);
  const version = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!version) {
    throw new Error(`ripgrep runtime at ${path} did not report a version`);
  }

  return {
    path,
    version,
    source,
  };
}
