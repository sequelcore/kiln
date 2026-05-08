import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isApplicationAliasMatch,
  normalizeApplicationAliases,
  normalizeApplicationList,
  type ApplicationAliasMap,
} from "./application-aliases.js";
import type {
  InteractiveObservationMetadata,
  InteractiveUseProvider,
  InteractiveUseProviderResult,
  InteractiveUseRequest,
} from "@kilnai/core";

export const WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE =
  "Windows UI Automation provider is not available. Build the Kiln Windows UIA sidecar before enabling interactiveUse.computerProvider=windows-uia. Run: packages\\runtime\\native\\windows-uia\\build.cmd";

export interface WindowsUiaComputerUseProviderOptions {
  readonly allowComputer?: boolean;
  readonly allowedApplications?: readonly string[];
  readonly applicationAliases?: ApplicationAliasMap;
  readonly maxAccessibilityDepth?: number;
  readonly sidecarPath?: string;
  readonly runner?: WindowsUiaSidecarRunner;
}

export type WindowsUiaSidecarRunner = (request: WindowsUiaSidecarRequest) => Promise<WindowsUiaSidecarResponse>;

export interface WindowsUiaSidecarRequest {
  readonly operation:
    | "observe"
    | "click"
    | "type"
    | "open_application"
    | "focus_application"
    | "minimize_application"
    | "close_application";
  readonly includeAccessibility?: boolean;
  readonly maxDepth?: number;
  readonly selector?: string;
  readonly text?: string;
  readonly application?: string;
  readonly windowTitle?: string;
  readonly timeoutMs?: number;
}

export interface WindowsUiaSidecarResponse {
  readonly observation: {
    readonly application?: string;
    readonly windowTitle?: string;
    readonly visibleText?: string;
    readonly closeMethod?: "uia-window-pattern" | "win32-sc-close" | "win32-wm-close" | "win32-post-message";
  };
}

export class WindowsUiaComputerUseProvider implements InteractiveUseProvider {
  private readonly allowComputer: boolean;
  private readonly allowedApplications: readonly string[];
  private readonly applicationAliases: ApplicationAliasMap;
  private readonly maxAccessibilityDepth: number;
  private readonly runner: WindowsUiaSidecarRunner;

  constructor(options: WindowsUiaComputerUseProviderOptions = {}) {
    this.allowComputer = options.allowComputer === true;
    this.allowedApplications = normalizeApplicationList(options.allowedApplications);
    this.applicationAliases = normalizeApplicationAliases(options.applicationAliases);
    this.maxAccessibilityDepth = clampDepth(options.maxAccessibilityDepth);
    this.runner = options.runner ?? createWindowsUiaSidecarRunner(options.sidecarPath);
  }

  async execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const requestedAuthority = this.readRequestedAuthority(request);
    this.assertComputerAllowed(requestedAuthority, request.operation);
    const normalizedAuthority = requestedAuthority ? this.normalizeRequestedAuthority(requestedAuthority) : null;
    if (requestedAuthority) {
      this.assertRequestedApplicationAllowed(requestedAuthority, request.operation);
    } else {
      const authority = await this.runner({
        operation: "observe",
        includeAccessibility: false,
        maxDepth: 1,
        timeoutMs: readTimeoutMs(request.input),
      });
      this.assertApplicationAllowed(authority.observation);
    }

    switch (request.operation) {
      case "observe":
        if (normalizedAuthority) {
          await this.focusRequestedApplication(normalizedAuthority, request);
        }
        return {
          provider: "windows-uia",
          observation: await this.observe(request),
        };
      case "click":
        if (normalizedAuthority) {
          await this.focusRequestedApplication(normalizedAuthority, request);
        }
        return {
          provider: "windows-uia",
          observation: await this.click(request),
        };
      case "type":
        if (normalizedAuthority) {
          await this.focusRequestedApplication(normalizedAuthority, request);
        }
        return {
          provider: "windows-uia",
          observation: await this.type(request),
        };
      case "open_application":
      case "focus_application":
      case "minimize_application":
      case "close_application":
        if (!normalizedAuthority) {
          throw new Error(`Computer ${request.operation.replace(/_/g, " ")} requires an application or windowTitle.`);
        }
        return {
          provider: "windows-uia",
          observation: (await this.runner({
            operation: request.operation,
            application: normalizedAuthority.application,
            windowTitle: normalizedAuthority.windowTitle,
            timeoutMs: readTimeoutMs(request.input),
          })).observation,
        };
      case "keypress":
        throw new Error("Windows UI Automation provider does not support raw keypress. Use computerProvider=windows for keyboard input.");
      default:
        throw new Error(`Windows UI Automation provider does not support operation '${request.operation}'.`);
    }
  }

  private assertComputerAllowed(
    requestedAuthority: { readonly application?: string; readonly windowTitle?: string } | null,
    operation: InteractiveUseRequest["operation"],
  ): void {
    if (!this.allowComputer) {
      throw new Error("Computer automation is disabled. Set interactiveUse.allowComputer=true before using computer tools.");
    }
    if (
      this.allowedApplications.length === 0
      && !(operation === "focus_application" && requestedAuthority && isKilnOperatorSelfAuthority(requestedAuthority))
    ) {
      throw new Error("Computer automation application policy is missing. Configure interactiveUse.allowedApplications before using computer tools.");
    }
  }

  private assertApplicationAllowed(authority: WindowsUiaSidecarResponse["observation"]): void {
    if (this.allowedApplications.includes("*")) {
      return;
    }
    const application = authority.application;
    const windowTitle = authority.windowTitle;
    if (!application && !windowTitle) {
      throw new Error("Computer automation could not determine the active application or window title from Windows UI Automation.");
    }
    const allowed = this.allowedApplications.some((entry) => {
      return isApplicationAliasMatch(application, entry, this.applicationAliases)
        || isApplicationAliasMatch(windowTitle, entry, this.applicationAliases);
    });
    if (!allowed) {
      const label = application ?? windowTitle ?? "unknown";
      throw new Error(`Computer automation denied for active application '${label}'. Configure interactiveUse.allowedApplications to allow it.`);
    }
  }

  private readRequestedAuthority(request: InteractiveUseRequest): { readonly application?: string; readonly windowTitle?: string } | null {
    const application = readString(request.input.application) ?? request.application;
    const windowTitle = readString(request.input.windowTitle) ?? request.windowTitle;
    return application || windowTitle
      ? {
          ...(application ? { application } : {}),
          ...(windowTitle ? { windowTitle } : {}),
        }
      : null;
  }

  private assertRequestedApplicationAllowed(
    authority: { readonly application?: string; readonly windowTitle?: string },
    operation: InteractiveUseRequest["operation"],
  ): void {
    if (this.allowedApplications.includes("*")) {
      return;
    }
    const label = authority.application ?? authority.windowTitle;
    if (!label) {
      throw new Error("Computer automation requires an application or window title before targeting an inactive app.");
    }
    if (operation === "focus_application" && isKilnOperatorSelfAuthority(authority)) {
      return;
    }
    const allowed = this.allowedApplications.some((entry) => {
      return isApplicationAliasMatch(authority.application, entry, this.applicationAliases)
        || isApplicationAliasMatch(authority.windowTitle, entry, this.applicationAliases);
    });
    if (!allowed) {
      throw new Error(`Computer automation denied for requested application '${label}'. Configure interactiveUse.allowedApplications to allow it.`);
    }
  }

  private async focusRequestedApplication(
    authority: { readonly application?: string; readonly windowTitle?: string },
    request: InteractiveUseRequest,
  ): Promise<void> {
    await this.runner({
      operation: "focus_application",
      application: authority.application,
      windowTitle: authority.windowTitle,
      timeoutMs: readTimeoutMs(request.input),
    });
  }

  private normalizeRequestedAuthority(
    authority: { readonly application?: string; readonly windowTitle?: string },
  ): { readonly application?: string; readonly windowTitle?: string } {
    if (!authority.application || this.allowedApplications.includes("*")) {
      return authority;
    }
    const canonical = this.allowedApplications.find((entry) => isApplicationAliasMatch(authority.application, entry, this.applicationAliases));
    return canonical
      ? { ...authority, application: canonical }
      : authority;
  }

  private async observe(request: InteractiveUseRequest): Promise<InteractiveObservationMetadata> {
    const includeAccessibility = request.observationRequest?.includeAccessibility === true
      || request.input.includeAccessibility === true;
    return (await this.runner({
      operation: "observe",
      includeAccessibility,
      maxDepth: this.maxAccessibilityDepth,
      timeoutMs: readTimeoutMs(request.input),
    })).observation;
  }

  private async click(request: InteractiveUseRequest): Promise<InteractiveObservationMetadata> {
    const selector = readSelector(request);
    if (!selector) {
      if (readPoint(request.input.target) ?? readActionPoint(request.action)) {
        throw new Error("Windows UI Automation provider requires a semantic selector/ref for clicks. Use computerProvider=windows for coordinate-only pointer actions.");
      }
      throw new Error("Computer click requires a UIA selector/ref.");
    }
    return (await this.runner({
      operation: "click",
      selector,
      timeoutMs: readTimeoutMs(request.input),
    })).observation;
  }

  private async type(request: InteractiveUseRequest): Promise<InteractiveObservationMetadata> {
    const selector = readSelector(request);
    if (!selector) {
      throw new Error("Windows UI Automation provider requires a target selector/ref for text input. Use computerProvider=windows for keyboard typing into the current focus.");
    }
    return (await this.runner({
      operation: "type",
      selector,
      text: readRequiredText(request.input),
      timeoutMs: readTimeoutMs(request.input),
    })).observation;
  }
}

export function createWindowsUiaSidecarRunner(sidecarPath?: string): WindowsUiaSidecarRunner {
  let resolvedPath: Promise<string> | undefined;
  return async (request) => {
    resolvedPath ??= resolveWindowsUiaSidecarPath(sidecarPath);
    const executable = await resolvedPath;
    const stdout = await runWindowsUiaSidecar(executable, request).catch((error: unknown) => {
      if (isMissingExecutableError(error)) {
        throw new Error(WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE);
      }
      throw new Error(`Windows UI Automation sidecar failed: ${readErrorMessage(error)}`);
    });
    return parseSidecarResponse(stdout);
  };
}

async function resolveWindowsUiaSidecarPath(configuredPath: string | undefined): Promise<string> {
  if (configuredPath) {
    try {
      await access(configuredPath);
      return configuredPath;
    } catch {
      throw new Error(WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE);
    }
  }

  const candidates = [
    process.env.KILN_WINDOWS_UIA_HELPER,
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "native", "windows-uia", "bin", "kiln-windows-uia.exe"),
    join(process.cwd(), "packages", "runtime", "native", "windows-uia", "bin", "kiln-windows-uia.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep trying the next deterministic location.
    }
  }
  throw new Error(WINDOWS_UIA_COMPUTER_USE_MISSING_DEPENDENCY_MESSAGE);
}

function runWindowsUiaSidecar(executable: string, request: WindowsUiaSidecarRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutMs = request.timeoutMs ?? 10000;
    const child = spawn(executable, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024 && !settled) {
        settled = true;
        child.kill();
        reject(new Error("stdout exceeded 1048576 bytes"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function parseSidecarResponse(stdout: string): WindowsUiaSidecarResponse {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("sidecar response is not an object");
    }
    const observation = (parsed as Record<string, unknown>).observation;
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new Error("sidecar response is missing observation");
    }
    const record = observation as Record<string, unknown>;
    return {
      observation: {
        ...stringField("application", record.application),
        ...stringField("windowTitle", record.windowTitle),
        ...stringField("visibleText", record.visibleText),
        ...closeMethodField(record.closeMethod),
      },
    };
  } catch (error) {
    throw new Error(`Windows UI Automation sidecar returned invalid JSON: ${readErrorMessage(error)}`);
  }
}

function readSelector(request: InteractiveUseRequest): string | undefined {
  const selector = request.action?.selector
    ?? request.action?.ref
    ?? readTargetString(request.input.target, "selector")
    ?? readTargetString(request.input.target, "ref")
    ?? readSemanticTargetSelector(request.input.target);
  return normalizeUiaSelector(selector);
}

function readRequiredText(input: Record<string, unknown>): string {
  if (typeof input.text !== "string") {
    throw new Error("Computer type requires text.");
  }
  return input.text;
}

function readPoint(value: unknown): { readonly x: number; readonly y: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number" && Number.isFinite(record.x) && typeof record.y === "number" && Number.isFinite(record.y)
    ? { x: record.x, y: record.y }
    : null;
}

function readActionPoint(action: { readonly x?: unknown; readonly y?: unknown } | undefined): { readonly x: number; readonly y: number } | null {
  return typeof action?.x === "number" && typeof action.y === "number"
    ? { x: action.x, y: action.y }
    : null;
}

function readTargetString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;
}

function readSemanticTargetSelector(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const parts = [
    selectorPart("type", record.type ?? record.controlType),
    selectorPart("title", record.title ?? record.name),
    selectorPart("automationId", record.automationId ?? record.id),
    selectorPart("className", record.className),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(";") : undefined;
}

function selectorPart(key: string, value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? `${key}=${value.trim()}`
    : undefined;
}

function normalizeUiaSelector(selector: string | undefined): string | undefined {
  if (!selector) {
    return undefined;
  }
  const trimmed = selector.trim();
  if (trimmed.startsWith("#") && trimmed.length > 1 && !trimmed.includes(";")) {
    return `automationId=${trimmed.slice(1)}`;
  }
  if (trimmed.startsWith(".") && trimmed.length > 1 && !trimmed.includes(";")) {
    return `className=${trimmed.slice(1)}`;
  }
  const accessibilityLine = /^(?:.+?)\s+"([^"]+)"(?:\s+#[^\s]+)?(?:\s+\.([^\s]+))?$/u.exec(trimmed);
  if (accessibilityLine) {
    const [, title, className] = accessibilityLine;
    return [
      selectorPart("title", title),
      selectorPart("className", className),
    ].filter((part): part is string => Boolean(part)).join(";");
  }
  return trimmed;
}

function readTimeoutMs(input: Record<string, unknown>): number | undefined {
  return typeof input.timeout === "number" && Number.isFinite(input.timeout)
    ? Math.max(1, Math.floor(input.timeout))
    : undefined;
}

function stringField<TName extends string>(name: TName, value: unknown): Record<TName, string> | Record<string, never> {
  return typeof value === "string" && value.trim().length > 0
    ? { [name]: value.trim() } as Record<TName, string>
    : {};
}

function closeMethodField(value: unknown): Pick<WindowsUiaSidecarResponse["observation"], "closeMethod"> | Record<string, never> {
  return value === "uia-window-pattern"
    || value === "win32-sc-close"
    || value === "win32-wm-close"
    || value === "win32-post-message"
    ? { closeMethod: value }
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isKilnOperatorSelfAuthority(authority: { readonly application?: string; readonly windowTitle?: string }): boolean {
  return isKilnOperatorName(authority.application) || isKilnOperatorName(authority.windowTitle);
}

function isKilnOperatorName(value: string | undefined): boolean {
  return value?.toLocaleLowerCase("en-US").trim() === "kiln";
}

function clampDepth(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.floor(value)))
    : 4;
}

function isMissingExecutableError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT" || (error as { readonly code?: unknown }).code === "UNKNOWN");
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
