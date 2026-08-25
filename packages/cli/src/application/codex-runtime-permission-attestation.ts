import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { runCodexAppServerRuntimePermissionAttestation } from "./codex-app-server-thread-continuity.js";
import { inspectCodexNativeClient } from "./codex-native-client-inspection.js";
import { resolveProjectStateBinding } from "./project-state-root.js";
import { readNativeProjectionInstallState } from "../config/native-projection-state.js";
import {
  codexRuntimePermissionComponentValues,
  createRuntimePermissionObservationStore,
  deriveCodexRuntimePermissionRequest,
  type RuntimePermissionObservationStore,
} from "../wrapper/runtime-permission-observation.js";

export const CODEX_RUNTIME_ATTESTATION_VERSION = "0.149.1" as const;

type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexRuntimePermissionAttestationResult {
  readonly harness: "codex";
  readonly protocol: "codex-app-server-v2";
  readonly runtimeVersion: typeof CODEX_RUNTIME_ATTESTATION_VERSION;
  readonly executableDigest: string;
  readonly processId: number;
  readonly proof: "proven" | "inferred" | "contradictory";
  readonly components: ReturnType<typeof codexRuntimePermissionComponentValues>;
  readonly observedAt: string;
}

export interface CodexRuntimePermissionAttestationDependencies {
  readonly inspectClient: () => { readonly executable: string; readonly version: string };
  readonly readInstalledPolicy: (projectPath: string) => { readonly approvalMode: ApprovalMode; readonly sandboxMode: SandboxMode };
  readonly digestExecutable: (executable: string) => Promise<string>;
  readonly runAttestation: typeof runCodexAppServerRuntimePermissionAttestation;
  readonly createObservationStore: (projectPath: string) => Pick<RuntimePermissionObservationStore, "recordRequested" | "recordObserved">;
  readonly now?: () => Date;
  readonly createSessionId?: () => string;
}

const DEFAULT_DEPENDENCIES: CodexRuntimePermissionAttestationDependencies = {
  inspectClient: () => inspectCodexNativeClient(),
  readInstalledPolicy,
  digestExecutable,
  runAttestation: runCodexAppServerRuntimePermissionAttestation,
  createObservationStore: (projectPath) => createRuntimePermissionObservationStore({ projectPath }),
};

export async function attestCodexRuntimePermissions(
  input: { readonly projectPath: string },
  dependencies: CodexRuntimePermissionAttestationDependencies = DEFAULT_DEPENDENCIES,
): Promise<CodexRuntimePermissionAttestationResult> {
  const client = dependencies.inspectClient();
  if (client.version !== CODEX_RUNTIME_ATTESTATION_VERSION) {
    throw new Error(`Codex runtime attestation supports app-server ${CODEX_RUNTIME_ATTESTATION_VERSION}; found ${client.version}.`);
  }
  const installed = dependencies.readInstalledPolicy(input.projectPath);
  if (installed.approvalMode === "on-failure") {
    throw new Error(`Codex app-server ${CODEX_RUNTIME_ATTESTATION_VERSION} cannot attest approval policy on-failure.`);
  }
  const observedAt = (dependencies.now ?? (() => new Date()))();
  const runtimeVersion = { kind: "executable" as const, version: client.version };
  const store = dependencies.createObservationStore(input.projectPath);
  const requested = await store.recordRequested(deriveCodexRuntimePermissionRequest({
    sessionId: (dependencies.createSessionId ?? randomUUID)(),
    approvalMode: installed.approvalMode,
    sandboxMode: installed.sandboxMode,
    requestedAt: observedAt,
    runtimeVersion,
  }));
  const executableDigest = await dependencies.digestExecutable(client.executable);
  const attestation = await dependencies.runAttestation({
    executable: client.executable,
    cwd: input.projectPath,
  });
  const components = {
    approvalControl: `approval:${attestation.proof.approvalMode}`,
    filesystemSandbox: `sandbox:${attestation.proof.sandboxMode}`,
    networkBoundary: `network:${attestation.proof.networkAccess}`,
  } as const;
  const observed = await store.recordObserved(requested, {
    observedAt,
    componentValues: components,
    runtimeIdentity: {
      protocol: attestation.proof.protocol,
      executableDigest,
      processId: attestation.processId,
      threadDigest: digest(attestation.proof.threadId),
    },
    runtimeVersion,
  });
  return {
    harness: "codex",
    protocol: "codex-app-server-v2",
    runtimeVersion: CODEX_RUNTIME_ATTESTATION_VERSION,
    executableDigest,
    processId: attestation.processId,
    proof: observed.proof,
    components,
    observedAt: observed.observedAt,
  };
}

function readInstalledPolicy(projectPath: string): { readonly approvalMode: ApprovalMode; readonly sandboxMode: SandboxMode } {
  const binding = resolveProjectStateBinding(projectPath);
  const target = readNativeProjectionInstallState(binding.projectionsPath).targets["codex-config"];
  if (!target?.permissionIntegrity || target.permissionIntegrity.harness !== "codex") {
    throw new Error("No exact native Codex permission projection is installed.");
  }
  let parsed: unknown;
  try {
    parsed = parseToml(readFileSync(target.filePath, "utf8"));
  } catch {
    throw new Error("Installed native Codex permission configuration is unreadable.");
  }
  if (!isRecord(parsed)) throw new Error("Installed native Codex permission configuration is invalid.");
  const approvalMode = parsed.approval_policy;
  const sandboxMode = parsed.sandbox_mode;
  if (!isApprovalMode(approvalMode) || !isSandboxMode(sandboxMode)) {
    throw new Error("Installed native Codex permission policy is incomplete or unsupported.");
  }
  return { approvalMode, sandboxMode };
}

async function digestExecutable(executable: string): Promise<string> {
  return createHash("sha256").update(await readFile(executable)).digest("hex");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted";
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
