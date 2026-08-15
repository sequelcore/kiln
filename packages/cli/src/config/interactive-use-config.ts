import type { ArtifactResourceStore, DefaultBuiltinToolRegistryOptions } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { loadKilnConfig } from "./config-merger.js";
import type {
  ResolvedKilnConfig,
  KilnYamlInteractiveUseBrowserEnvironment,
  KilnYamlInteractiveUseBrowserProvider,
  KilnYamlInteractiveUseComputerEnvironment,
  KilnYamlInteractiveUseComputerProvider,
  KilnYamlInteractiveUseConfig,
  KilnYamlInteractiveUseProvider,
} from "../kiln-yaml-types.js";

const VALID_BROWSER_PROVIDERS: readonly KilnYamlInteractiveUseBrowserProvider[] = [
  "none",
  "playwright",
];
const VALID_COMPUTER_PROVIDERS: readonly KilnYamlInteractiveUseComputerProvider[] = [
  "none",
  "windows",
  "windows-uia",
];
const VALID_BROWSER_ENVIRONMENTS: readonly KilnYamlInteractiveUseBrowserEnvironment[] = [
  "isolated-headless",
  "isolated-headed",
];
const VALID_COMPUTER_ENVIRONMENTS: readonly KilnYamlInteractiveUseComputerEnvironment[] = [
  "local-active-desktop",
];

export interface InteractiveUseConfigurationDiagnostics {
  readonly enabled: boolean;
  readonly allowedDomains: readonly string[];
  readonly allowedApplications: readonly string[];
  readonly applicationAliases: Readonly<Record<string, readonly string[]>>;
  readonly allowExternalBrowser: boolean;
  readonly allowComputer: boolean;
  readonly browserEnvironment: KilnYamlInteractiveUseBrowserEnvironment;
  readonly computerEnvironment: KilnYamlInteractiveUseComputerEnvironment;
  readonly browserProviderType: KilnYamlInteractiveUseBrowserProvider | "invalid";
  readonly browserProviderConfigured: boolean;
  readonly computerProviderType: KilnYamlInteractiveUseComputerProvider | "invalid";
  readonly computerProviderConfigured: boolean;
  readonly issues: readonly string[];
}

export interface InteractiveUseToolSurfaceOptionsInput {
  readonly artifactStore?: ArtifactResourceStore;
}

export async function loadConfiguredInteractiveUseToolSurfaceOptions(
  appConfig: KilnAppConfig,
  projectPath: string,
  options: InteractiveUseToolSurfaceOptionsInput = {},
): Promise<DefaultBuiltinToolRegistryOptions> {
  const config = appConfig.kilnYaml ?? await loadKilnConfig(projectPath);
  return createInteractiveUseToolSurfaceOptions(config, options);
}

export async function createInteractiveUseToolSurfaceOptions(
  config: ResolvedKilnConfig | null | undefined,
  options: InteractiveUseToolSurfaceOptionsInput = {},
): Promise<DefaultBuiltinToolRegistryOptions> {
  const interactiveUse = config?.interactiveUse;
  if (interactiveUse?.enabled !== true) {
    return {};
  }

  assertValidInteractiveUseConfig(interactiveUse);

  if (interactiveUse.browserProvider === "playwright") {
    const runtime = await import("@kilnai/runtime");
    const captureRecorder = options.artifactStore
      ? new runtime.PlaywrightBrowserCaptureRecorder({ artifactStore: options.artifactStore })
      : undefined;
    return {
      ...(options.artifactStore ? { artifactResources: { store: options.artifactStore } } : {}),
      browserUse: {
        provider: new runtime.PlaywrightBrowserUseProvider({
          allowedDomains: normalizeStringList(interactiveUse.allowedDomains),
          allowExternalBrowser: interactiveUse.allowExternalBrowser === true,
          liveStream: { enabled: true },
          ...(captureRecorder ? { captureRecorder } : {}),
          ...playwrightBrowserEnvironmentOptions(readBrowserEnvironment(interactiveUse.browserEnvironment)),
        }),
      },
      ...(interactiveUse.computerProvider === "windows" || interactiveUse.computerProvider === "windows-uia"
        ? {
            computerUse: {
              provider: createWindowsComputerProvider(runtime, interactiveUse),
            },
          }
        : {}),
    };
  }

  if (interactiveUse.computerProvider === "windows" || interactiveUse.computerProvider === "windows-uia") {
    const runtime = await import("@kilnai/runtime");
    return {
      ...(options.artifactStore ? { artifactResources: { store: options.artifactStore } } : {}),
      computerUse: {
        provider: createWindowsComputerProvider(runtime, interactiveUse),
      },
    };
  }

  return {};
}

export function describeInteractiveUseConfiguration(
  config: ResolvedKilnConfig | null | undefined,
): InteractiveUseConfigurationDiagnostics {
  const interactiveUse = config?.interactiveUse;
  const enabled = interactiveUse?.enabled === true;
  const browserProviderType = readBrowserProviderType(interactiveUse?.browserProvider);
  const computerProviderType = readComputerProviderType(interactiveUse?.computerProvider);
  const allowExternalBrowser = interactiveUse?.allowExternalBrowser === true;
  const allowComputer = interactiveUse?.allowComputer === true;
  const allowedDomains = normalizeStringList(interactiveUse?.allowedDomains);
  const allowedApplications = normalizeStringList(interactiveUse?.allowedApplications);
  const applicationAliases = normalizeStringListRecord(interactiveUse?.applicationAliases);
  const browserEnvironment = readBrowserEnvironment(interactiveUse?.browserEnvironment);
  const computerEnvironment = readComputerEnvironment(interactiveUse?.computerEnvironment);
  const issues: string[] = [];

  if (!enabled) {
    issues.push("interactive_use.disabled");
  }
  if (browserProviderType === "invalid") {
    issues.push("interactive_use.browser_provider_invalid");
  }
  if (computerProviderType === "invalid") {
    issues.push("interactive_use.computer_provider_invalid");
  }
  if (interactiveUse?.browserEnvironment !== undefined && browserEnvironment === "invalid") {
    issues.push("interactive_use.browser_environment_invalid");
  }
  if (interactiveUse?.computerEnvironment !== undefined && computerEnvironment === "invalid") {
    issues.push("interactive_use.computer_environment_invalid");
  }
  if (enabled && !isProviderConfigured(browserProviderType) && !isProviderConfigured(computerProviderType)) {
    issues.push("interactive_use.provider_missing");
  }
  if (enabled && browserProviderType === "playwright" && allowedDomains.length === 0 && !allowExternalBrowser) {
    issues.push("interactive_use.browser_domain_policy_missing");
  }
  if (enabled && allowComputer && allowedApplications.length === 0) {
    issues.push("interactive_use.computer_application_policy_missing");
  }
  if (enabled && isWindowsComputerProvider(computerProviderType) && !allowComputer) {
    issues.push("interactive_use.computer_not_allowed");
  }

  return {
    enabled,
    allowedDomains,
    allowedApplications,
    applicationAliases,
    allowExternalBrowser,
    allowComputer,
    browserEnvironment: browserEnvironment === "invalid" ? "isolated-headless" : browserEnvironment,
    computerEnvironment: computerEnvironment === "invalid" ? "local-active-desktop" : computerEnvironment,
    browserProviderType,
    browserProviderConfigured: isProviderConfigured(browserProviderType),
    computerProviderType,
    computerProviderConfigured: isProviderConfigured(computerProviderType),
    issues,
  };
}

function readBrowserProviderType(
  value: KilnYamlInteractiveUseConfig["browserProvider"] | undefined,
): KilnYamlInteractiveUseBrowserProvider | "invalid" {
  if (value === undefined) {
    return "none";
  }
  return VALID_BROWSER_PROVIDERS.includes(value) ? value : "invalid";
}

function readComputerProviderType(
  value: KilnYamlInteractiveUseConfig["computerProvider"] | undefined,
): KilnYamlInteractiveUseComputerProvider | "invalid" {
  if (value === undefined) {
    return "none";
  }
  return VALID_COMPUTER_PROVIDERS.includes(value) ? value : "invalid";
}

function isProviderConfigured(value: KilnYamlInteractiveUseProvider | "invalid"): boolean {
  return value !== "none" && value !== "invalid";
}

function assertValidInteractiveUseConfig(interactiveUse: KilnYamlInteractiveUseConfig): void {
  if (interactiveUse.browserProvider !== undefined && readBrowserProviderType(interactiveUse.browserProvider) === "invalid") {
    throw new Error("Invalid interactiveUse.browserProvider. Must be none or playwright.");
  }
  if (interactiveUse.computerProvider !== undefined && readComputerProviderType(interactiveUse.computerProvider) === "invalid") {
    throw new Error("Invalid interactiveUse.computerProvider. Must be none, windows, or windows-uia.");
  }
  if (interactiveUse.browserEnvironment !== undefined && readBrowserEnvironment(interactiveUse.browserEnvironment) === "invalid") {
    throw new Error("Invalid interactiveUse.browserEnvironment. Must be isolated-headless or isolated-headed.");
  }
  if (interactiveUse.computerEnvironment !== undefined && readComputerEnvironment(interactiveUse.computerEnvironment) === "invalid") {
    throw new Error("Invalid interactiveUse.computerEnvironment. Must be local-active-desktop.");
  }
}

function readBrowserEnvironment(
  value: KilnYamlInteractiveUseConfig["browserEnvironment"] | undefined,
): KilnYamlInteractiveUseBrowserEnvironment | "invalid" {
  if (value === undefined) {
    return "isolated-headless";
  }
  return VALID_BROWSER_ENVIRONMENTS.includes(value) ? value : "invalid";
}

function readComputerEnvironment(
  value: KilnYamlInteractiveUseConfig["computerEnvironment"] | undefined,
): KilnYamlInteractiveUseComputerEnvironment | "invalid" {
  if (value === undefined) {
    return "local-active-desktop";
  }
  return VALID_COMPUTER_ENVIRONMENTS.includes(value) ? value : "invalid";
}

function isWindowsComputerProvider(value: KilnYamlInteractiveUseComputerProvider | "invalid"): boolean {
  return value === "windows" || value === "windows-uia";
}

function createWindowsComputerProvider(
  runtime: typeof import("@kilnai/runtime"),
  interactiveUse: KilnYamlInteractiveUseConfig,
) {
  const options = {
    allowComputer: interactiveUse.allowComputer === true,
    allowedApplications: normalizeStringList(interactiveUse.allowedApplications),
    applicationAliases: normalizeStringListRecord(interactiveUse.applicationAliases),
  };
  return interactiveUse.computerProvider === "windows-uia"
    ? new runtime.WindowsUiaComputerUseProvider(options)
    : new runtime.WindowsComputerUseProvider(options);
}

function playwrightBrowserEnvironmentOptions(
  environment: KilnYamlInteractiveUseBrowserEnvironment | "invalid",
): { readonly headless: boolean; readonly allowHeaded: boolean } {
  if (environment === "isolated-headed") {
    return { headless: false, allowHeaded: true };
  }
  return { headless: true, allowHeaded: false };
}

function normalizeStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (normalized && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

function normalizeStringListRecord(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, readonly string[]> = {};
  for (const [key, aliases] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedAliases = normalizeStringList(aliases);
    if (normalizedKey && normalizedAliases.length > 0) {
      out[normalizedKey] = normalizedAliases;
    }
  }
  return out;
}
