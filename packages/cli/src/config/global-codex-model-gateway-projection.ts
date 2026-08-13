import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { ModelGatewayConfig, ModelGatewayVirtualModelConfig } from "@kilnai/core";
import {
  CODEX_COMPOSITE_PATH_PREFIX,
  createCodexCompositeCapability,
  createModelGatewayConfigDigest,
  type ModelGatewayListenerIdentity,
} from "@kilnai/runtime";
import {
  createNativeProjectionFileSnapshot,
  createNativeProjectionSnapshot,
  detectNativeProjectionDrift,
  detectNativeProjectionFileDrift,
  mergeManagedFields,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  stripManagedFields,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
} from "./native-projection-state.js";
import { runGlobalNativeProjectionTransaction, type GlobalNativeProjectionLockToken } from "./global-native-projection-lock.js";

export const GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID = "global-codex-model-gateway";
export const GLOBAL_CODEX_MODEL_CATALOG_TARGET_ID = "global-codex-model-catalog";
const MANAGED_CONFIG_FIELDS = ["openai_base_url", "model_catalog_json"] as const;

export interface CodexNativeCatalog {
  readonly models: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

interface SyncGlobalCodexModelGatewayProjectionInput {
  readonly config: ModelGatewayConfig;
  readonly listener?: ModelGatewayListenerIdentity;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nativeCatalog: CodexNativeCatalog;
  readonly targetPath: string;
  readonly catalogPath: string;
  readonly installStateDir: string;
  readonly operation: "install" | "uninstall";
  readonly adoptExisting?: boolean;
  readonly force?: boolean;
  readonly lock?: GlobalNativeProjectionLockToken;
}

export function syncGlobalCodexModelGatewayProjection(input: SyncGlobalCodexModelGatewayProjectionInput): Promise<{ readonly operation: "install" | "uninstall"; readonly changed: boolean; readonly targetPath: string; readonly catalogPath: string }> {
  return runGlobalNativeProjectionTransaction(input.installStateDir, input.lock, () => syncGlobalCodexModelGatewayProjectionUnlocked(input));
}

async function syncGlobalCodexModelGatewayProjectionUnlocked(input: SyncGlobalCodexModelGatewayProjectionInput): Promise<{ readonly operation: "install" | "uninstall"; readonly changed: boolean; readonly targetPath: string; readonly catalogPath: string }> {
  if (input.force && input.operation !== "install") throw new Error("Forcing the Codex composite projection is valid only for owned install repair.");
  if (input.operation === "install") {
    if (!input.listener) throw new Error("Installing the Codex composite projection requires an owned ready listener.");
    requireExactListener(input.config, input.listener);
  }
  const originalConfig = existsSync(input.targetPath) ? readFileSync(input.targetPath, "utf8") : undefined;
  const originalCatalog = existsSync(input.catalogPath) ? readFileSync(input.catalogPath, "utf8") : undefined;
  const currentDocument = parseCodexDocument(originalConfig, input.targetPath);
  let state = readNativeProjectionInstallState(input.installStateDir);
  const configState = state.targets[GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID];
  const catalogState = state.targets[GLOBAL_CODEX_MODEL_CATALOG_TARGET_ID];
  requireStatePath(configState?.filePath, input.targetPath, "Codex config");
  requireStatePath(catalogState?.filePath, input.catalogPath, "Codex catalog");
  const configDrift = detectNativeProjectionDrift({ targetId: GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID, state, currentDocument });
  const catalogDrift = catalogState
    ? detectNativeProjectionFileDrift({ targetId: GLOBAL_CODEX_MODEL_CATALOG_TARGET_ID, state, currentContent: originalCatalog ?? "" })
    : undefined;
  if ((configDrift || catalogDrift) && !input.force) {
    throw new Error(`Global Codex composite managed state drift detected: ${[
      ...(configDrift?.driftedFields ?? []),
      ...(catalogDrift?.driftedFields.map((field) => `catalog:${field}`) ?? []),
    ].join(", ")}`);
  }

  if (input.operation === "uninstall") {
    if (!configState && !catalogState) return { operation: "uninstall", changed: false, targetPath: input.targetPath, catalogPath: input.catalogPath };
    const document = configState
      ? stripManagedFields({ currentDocument, managedFields: configState.managedFields })
      : currentDocument;
    commitFiles(input, originalConfig, originalCatalog, stringifyToml(document), undefined, () => {
      state = removeNativeProjectionTargetState(state, GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID);
      state = removeNativeProjectionTargetState(state, GLOBAL_CODEX_MODEL_CATALOG_TARGET_ID);
      writeNativeProjectionInstallState(input.installStateDir, state);
    });
    return { operation: "uninstall", changed: true, targetPath: input.targetPath, catalogPath: input.catalogPath };
  }

  if (!configState && !input.adoptExisting && MANAGED_CONFIG_FIELDS.some((field) => field in currentDocument)) {
    throw new Error("Codex native configuration contains an unmanaged composite base URL or catalog pointer; refusing to overwrite it.");
  }
  if (currentDocument.model_provider !== undefined && currentDocument.model_provider !== "openai") {
    throw new Error("Codex composite routing requires the built-in openai model provider.");
  }
  const principal = resolveCodexPrincipal(input.config);
  const token = (input.env ?? process.env)[principal.tokenEnv];
  if (!token) throw new Error(`Codex principal token '${principal.tokenEnv}' is missing.`);
  const capability = createCodexCompositeCapability(token);
  const patch = {
    openai_base_url: `http://127.0.0.1:${input.config.port}${CODEX_COMPOSITE_PATH_PREFIX}/${capability}/v1`,
    model_catalog_json: input.catalogPath,
  };
  const document = mergeManagedFields({ currentDocument, managedPatch: patch, managedFields: MANAGED_CONFIG_FIELDS });
  const catalog = buildCodexCompositeCatalog({ config: input.config, nativeCatalog: input.nativeCatalog });
  const catalogContent = `${JSON.stringify(catalog, null, 2)}\n`;
  const configSnapshot = createNativeProjectionSnapshot({ targetId: GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID, filePath: input.targetPath, document, managedFields: MANAGED_CONFIG_FIELDS });
  const catalogSnapshot = createNativeProjectionFileSnapshot({ targetId: GLOBAL_CODEX_MODEL_CATALOG_TARGET_ID, filePath: input.catalogPath, content: catalogContent, harness: "codex", sourceIdentity: "global-model-gateway-composite" });
  commitFiles(input, originalConfig, originalCatalog, stringifyToml(document), catalogContent, () => {
    state = upsertNativeProjectionTargetState(state, configSnapshot);
    state = upsertNativeProjectionTargetState(state, catalogSnapshot);
    writeNativeProjectionInstallState(input.installStateDir, state);
  });
  return { operation: "install", changed: true, targetPath: input.targetPath, catalogPath: input.catalogPath };
}

export function buildCodexCompositeCatalog(input: {
  readonly config: ModelGatewayConfig;
  readonly nativeCatalog: CodexNativeCatalog;
}): CodexNativeCatalog {
  if (!Array.isArray(input.nativeCatalog.models) || input.nativeCatalog.models.length === 0) {
    throw new Error("Codex returned an empty native model catalog.");
  }
  const template = input.nativeCatalog.models.find((model) => typeof model.slug === "string");
  if (!template) throw new Error("Codex native model catalog has no usable template.");
  const principal = resolveCodexPrincipal(input.config);
  const byId = new Map(input.config.virtualModels.map((model) => [model.id, model]));
  const nativeIds = new Set(input.nativeCatalog.models.map((model) => model.slug).filter((slug): slug is string => typeof slug === "string"));
  const firstPriority = Math.max(0, ...input.nativeCatalog.models.map((model) => typeof model.priority === "number" ? model.priority : 0)) + 1;
  const virtualModels = principal.virtualModelIds.map((id, index) => {
    if (nativeIds.has(id)) throw new Error(`Codex virtual model '${id}' collides with a native model ID.`);
    const model = byId.get(id);
    if (!model) throw new Error(`Codex principal references unknown virtual model '${id}'.`);
    return compositeModel(template, model, firstPriority + index);
  });
  return { ...structuredClone(input.nativeCatalog), models: [...structuredClone(input.nativeCatalog.models), ...virtualModels] };
}

function compositeModel(template: Record<string, unknown>, model: ModelGatewayVirtualModelConfig, priority: number): Record<string, unknown> {
  if (!model.displayName || !model.contextTokens || !model.outputTokens) {
    throw new Error(`Codex virtual model '${model.id}' is missing picker metadata.`);
  }
  const levels = model.deliberation?.levels ?? [];
  const instructions = typeof model.baseInstructions === "string" && model.baseInstructions.trim()
    ? model.baseInstructions
    : rewriteIdentity(typeof template.base_instructions === "string" ? template.base_instructions : "You are a coding agent.", model.displayName);
  const modelMessages = isRecord(template.model_messages)
    ? { ...structuredClone(template.model_messages), instructions_template: instructions }
    : { instructions_template: instructions };
  return {
    ...structuredClone(template),
    slug: model.id,
    display_name: model.displayName,
    description: `Governed by Kiln through ${model.displayName}.`,
    priority,
    shell_type: "disabled",
    visibility: "list",
    supported_in_api: true,
    default_reasoning_level: model.deliberation?.defaultLevel ?? levels[0],
    supported_reasoning_levels: levels.map((effort) => ({ effort, description: `${effort} reasoning` })),
    context_window: model.contextTokens,
    max_context_window: model.contextTokens,
    effective_context_window_percent: 95,
    input_modalities: model.capabilities.some((capability) => capability.startsWith("input-image")) ? ["text", "image"] : ["text"],
    supports_parallel_tool_calls: model.capabilities.includes("parallel-tool-calls"),
    supports_search_tool: false,
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    supports_image_detail_original: false,
    apply_patch_tool_type: null,
    multi_agent_version: "v1",
    experimental_supported_tools: [],
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
    availability_nux: null,
    upgrade: null,
    use_responses_lite: false,
    base_instructions: instructions,
    model_messages: modelMessages,
  };
}

function resolveCodexPrincipal(config: ModelGatewayConfig): ModelGatewayConfig["principals"][number] {
  const principals = config.principals.filter((principal) => principal.ingress === "openai-responses" && principal.nativeHarness === "codex");
  if (principals.length !== 1) throw new Error("Global modelGateway must declare exactly one Codex native Responses principal.");
  return principals[0]!;
}

function requireExactListener(config: ModelGatewayConfig, listener: ModelGatewayListenerIdentity): void {
  if (listener.service !== "kiln-model-gateway" || listener.status !== "ready" || listener.protocolVersion !== 1
    || listener.configDigest !== createModelGatewayConfigDigest(config) || listener.port !== config.port) {
    throw new Error("Model gateway listener identity does not match the canonical global modelGateway configuration.");
  }
}

function parseCodexDocument(content: string | undefined, path: string): Record<string, unknown> {
  if (content === undefined) return {};
  try {
    const parsed = parseToml(content) as unknown;
    if (!isRecord(parsed)) throw new Error("configuration root must be an object");
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/[\r\n]+/gu, " ").slice(0, 240) : "unknown parse error";
    throw new Error(`Codex native configuration is unreadable and was not modified at ${path}: ${detail}`);
  }
}

function commitFiles(
  input: { readonly targetPath: string; readonly catalogPath: string; readonly installStateDir: string },
  originalConfig: string | undefined,
  originalCatalog: string | undefined,
  configContent: string,
  catalogContent: string | undefined,
  writeState: () => void,
): void {
  try {
    writeFileAtomically(input.targetPath, configContent);
    if (catalogContent === undefined) rmSync(input.catalogPath, { force: true });
    else writeFileAtomically(input.catalogPath, catalogContent);
    writeState();
  } catch (error) {
    restoreFile(input.targetPath, originalConfig);
    restoreFile(input.catalogPath, originalCatalog);
    throw error;
  }
}

let writeSequence = 0;
function writeFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${++writeSequence}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

function restoreFile(path: string, content: string | undefined): void {
  if (content === undefined) rmSync(path, { force: true });
  else writeFileAtomically(path, content);
}

function requireStatePath(observed: string | undefined, expected: string, label: string): void {
  if (observed !== undefined && observed !== expected) throw new Error(`${label} install state targets a different path: ${observed}`);
}

function rewriteIdentity(text: string, displayName: string): string {
  return text
    .replace(/\b(?:a coding agent|an agent) based on GPT-5\b/gu, `a coding agent based on ${displayName}`)
    .replace(/\bbased on GPT-5\b/gu, `based on ${displayName}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
