import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import {
  resolveCommunicationIntent,
  renderCommunicationPromptProjection,
  type CommunicationResolution,
  type CommunicationIntentCandidate,
  type RouteAdmissionDecision,
} from "@kilnai/core";
import { loadAgentDefinitions } from "../application/agent-loader.js";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import {
  adoptLegacyNativeProjectionFile,
  createNativeProjectionFileSnapshot,
  detectNativeProjectionFileDrift,
  isFullyOwnedNativeProjectionFile,
  readNativeProjectionInstallState,
  removeNativeProjectionTargetState,
  upsertNativeProjectionTargetState,
  writeNativeProjectionInstallState,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
} from "./native-projection-state.js";
import { isSafeProjectionPathComponent, resolveProjectionPathWithin } from "./native-projection-paths.js";
import { backupNativeProjectionFile } from "./native-projection-backup.js";
import {
  describeProjectionDrift,
  isNativeProjectionHarnessDisabled,
  type ProjectionOutcome,
  type NativeProjectionSyncOptions,
} from "./native-projection-policy.js";
import { resolveNativeHarnessDir } from "./native-harness-home.js";
import { decideNativeAgentProjection, type NativeAgentProjectionDecision } from "./native-agent-projection-decision.js";
import { createManagedAgentRouteAdmissionResolver } from "./managed-agent-route-admission.js";
import { resolveNativeCommunication } from "./native-communication-capabilities.js";

export interface NativeAgentProjectionResult {
  claude: boolean;
  codex: boolean;
  opencode: boolean;
  synced: number;
  errors: string[];
  outcomes: readonly ProjectionOutcome[];
  unavailable: readonly NativeAgentProjectionUnavailable[];
  communication: readonly NativeAgentCommunicationProjectionEvidence[];
}

export interface NativeAgentCommunicationProjectionEvidence {
  readonly targetId: string;
  readonly agentName: string;
  readonly harness: "claude" | "codex" | "opencode";
  readonly resolution: CommunicationResolution;
}

export interface NativeAgentProjectionUnavailable {
  readonly targetId: string;
  readonly agentName: string;
  readonly harness: "claude" | "codex" | "opencode";
  readonly decision: Exclude<NativeAgentProjectionDecision, { readonly kind: "project" }>;
}

export interface NativeAgentProjectionOptions extends NativeProjectionSyncOptions {
  readonly communicationCandidates?: readonly CommunicationIntentCandidate[];
  readonly resolveRouteAdmission?: (input: {
    readonly agent: KilnAgentDefinition;
    readonly routeId?: string;
    readonly providerId: string;
    readonly model?: string;
    readonly harness: NativeAgentProjectionTarget["key"];
  }) => RouteAdmissionDecision | undefined;
}

interface NativeAgentProjectionTarget {
  readonly key: "claude" | "codex" | "opencode";
  readonly label: "Claude Code" | "Codex" | "OpenCode";
  readonly dir: string;
  readonly extension: "md" | "toml";
  readonly render: (agent: KilnAgentDefinition, nativeModel?: string, communication?: CommunicationResolution) => string;
}

interface NativeAgentFileSyncResult {
  readonly ok: boolean;
  readonly snapshot?: NativeProjectionTargetState;
  readonly removedTargetId?: string;
  readonly error?: string;
  readonly outcome: ProjectionOutcome;
  readonly unavailable?: NativeAgentProjectionUnavailable;
  readonly communication?: NativeAgentCommunicationProjectionEvidence;
}

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function escapeTomlMultiline(value: string): string {
  return value.replaceAll("\"\"\"", "\\\"\\\"\\\"");
}

export function agentToClaudeMd(agent: KilnAgentDefinition, nativeModel?: string, resolved?: CommunicationResolution): string {
  const communication = resolved ?? resolveNativeAgentCommunication(agent, "claude", nativeModel);
  const frontmatter: Record<string, unknown> = {
    name: agent.name,
    role: agent.role,
  };

  if (agent.displayName) {
    frontmatter.displayName = agent.displayName;
  }

  if (agent.nicknameCandidates && agent.nicknameCandidates.length > 0) {
    frontmatter.nicknameCandidates = [...agent.nicknameCandidates];
  }

  if (agent.description) {
    frontmatter.description = agent.description;
  }

  if (agent.goal) {
    frontmatter.goal = agent.goal;
  }

  if (agent.tools && agent.tools.length > 0) {
    frontmatter.tools = [...agent.tools];
  }

  if (nativeModel) {
    frontmatter.model = nativeModel;
  }

  if (agent.skills && agent.skills.length > 0) {
    frontmatter.skills = [...agent.skills];
  }

  if (agent.taskAffinity && agent.taskAffinity.length > 0) {
    frontmatter.taskAffinity = [...agent.taskAffinity];
  }

  if (agent.instructionProfiles && agent.instructionProfiles.length > 0) {
    frontmatter.instructionProfiles = [...agent.instructionProfiles];
  }

  if (agent.mode) {
    frontmatter.mode = agent.mode;
  }

  const yamlFrontmatter = stringify(frontmatter).trimEnd();
  const body = appendNativeCommunicationInstructions(agent.instructions ?? "", communication);
  return `---\n${yamlFrontmatter}\n---\n${body}`;
}

export function agentToCodexToml(agent: KilnAgentDefinition, nativeModel?: string, resolved?: CommunicationResolution): string {
  const communication = resolved ?? resolveNativeAgentCommunication(agent, "codex", nativeModel);
  const instructions = buildNativeAgentInstructions(agent, communication);
  const lines = [
    `name = "${escapeTomlString(agent.name)}"`,
    `description = "${escapeTomlString(agent.description ?? agent.role)}"`,
    `developer_instructions = """${escapeTomlMultiline(instructions)}"""`,
  ];

  if (nativeModel) {
    lines.push(`model = "${escapeTomlString(nativeModel)}"`);
  }
  if (communication.responseDetail.mechanism === "native" && communication.responseDetail.nativeValue) {
    lines.push(`model_verbosity = "${escapeTomlString(communication.responseDetail.nativeValue)}"`);
  }
  if (communication.interactionProfile.mechanism === "native" && communication.interactionProfile.nativeValue) {
    lines.push(`personality = "${escapeTomlString(communication.interactionProfile.nativeValue)}"`);
  }

  const nicknameCandidates = nativeNicknameCandidates(agent);
  if (nicknameCandidates.length > 0) {
    const renderedNicknames = nicknameCandidates
      .map((nickname) => `"${escapeTomlString(nickname)}"`)
      .join(", ");
    lines.push(`nickname_candidates = [${renderedNicknames}]`);
  }

  return `${lines.join("\n")}\n`;
}

export function agentToOpenCodeMd(agent: KilnAgentDefinition, nativeModel?: string, resolved?: CommunicationResolution): string {
  const communication = resolved ?? resolveNativeAgentCommunication(agent, "opencode", nativeModel);
  const frontmatter: Record<string, unknown> = {
    name: agent.name,
    description: agent.description ?? agent.role,
  };
  if (agent.displayName) {
    frontmatter.displayName = agent.displayName;
  }
  if (agent.nicknameCandidates && agent.nicknameCandidates.length > 0) {
    frontmatter.nicknameCandidates = [...agent.nicknameCandidates];
  }
  if (nativeModel) {
    frontmatter.model = nativeModel;
  }
  if (communication.responseDetail.mechanism === "native" && communication.responseDetail.nativeValue) {
    frontmatter.textVerbosity = communication.responseDetail.nativeValue;
  }
  if (agent.mode) {
    frontmatter.mode = agent.mode;
  }
  if (agent.skills && agent.skills.length > 0) {
    frontmatter.skills = [...agent.skills];
  }
  if (agent.taskAffinity && agent.taskAffinity.length > 0) {
    frontmatter.taskAffinity = [...agent.taskAffinity];
  }
  if (agent.instructionProfiles && agent.instructionProfiles.length > 0) {
    frontmatter.instructionProfiles = [...agent.instructionProfiles];
  }

  const yamlFrontmatter = stringify(frontmatter).trimEnd();
  const body = buildNativeAgentInstructions(agent, communication);
  return `---\n${yamlFrontmatter}\n---\n${body}`;
}

function buildNativeAgentInstructions(
  agent: KilnAgentDefinition,
  communication: CommunicationResolution,
): string {
  const base = [
    agent.displayName ? `Display name: ${agent.displayName}` : undefined,
    `Goal: ${agent.goal}`,
    agent.backstory ? `Backstory: ${agent.backstory}` : undefined,
    agent.instructionProfiles?.length ? `Instruction profiles: ${agent.instructionProfiles.join(", ")}` : undefined,
    agent.taskAffinity?.length ? `Task affinity: ${agent.taskAffinity.join(", ")}` : undefined,
    agent.instructions,
  ].filter((line): line is string => Boolean(line)).join("\n\n");
  return appendNativeCommunicationInstructions(base, communication);
}

function appendNativeCommunicationInstructions(
  base: string,
  communication: CommunicationResolution,
): string {
  const projection = renderCommunicationPromptProjection(communication);
  return `${base}${projection ?? ""}`;
}

function nativeNicknameCandidates(agent: KilnAgentDefinition): readonly string[] {
  const nicknames = new Set<string>();
  if (agent.displayName) {
    nicknames.add(agent.displayName);
  }
  for (const nickname of agent.nicknameCandidates ?? []) {
    nicknames.add(nickname);
  }
  return [...nicknames];
}

export async function syncNativeAgentProjections(
  projectPath: string,
  options: NativeAgentProjectionOptions = {},
): Promise<NativeAgentProjectionResult> {
  const errors: string[] = [];
  const outcomes: ProjectionOutcome[] = [];
  const unavailable: NativeAgentProjectionUnavailable[] = [];
  const communication: NativeAgentCommunicationProjectionEvidence[] = [];
  let synced = 0;
  const kilnDir = join(projectPath, ".kiln");
  let installState = readNativeProjectionInstallState(kilnDir);

  let agents: KilnAgentDefinition[];
  try {
    agents = options.userHome === undefined
      ? await loadAgentDefinitions(projectPath)
      : await loadAgentDefinitions(projectPath, { userHome: options.userHome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      claude: false,
      codex: false,
      opencode: false,
      synced: 0,
      errors: [`Agent load failed: ${message}`],
      outcomes: [{
        targetId: "native-agents",
        path: join(projectPath, ".kiln", "agents"),
        status: "failed",
        reason: `Agent load failed: ${message}`,
      }],
      unavailable,
      communication,
    };
  }

  const hasManagedAgentProjection = Object.keys(installState.targets)
    .some((targetId) => targetId.includes("-agent:"));
  if (agents.length === 0 && !hasManagedAgentProjection) {
    return { claude: true, codex: true, opencode: true, synced: 0, errors: [], outcomes, unavailable, communication };
  }
  const defaultAdmissionResolver = options.resolveRouteAdmission || !agents.some((agent) => agent.providerRoute)
    ? undefined
    : await createManagedAgentRouteAdmissionResolver(projectPath);
  const resolveRouteAdmission = options.resolveRouteAdmission
    ?? ((input) => defaultAdmissionResolver?.resolve(input.agent));

  const targets: NativeAgentProjectionTarget[] = [
    {
      key: "claude",
      label: "Claude Code",
      dir: join(resolveNativeHarnessDir("claude", options.userHome), "agents"),
      extension: "md",
      render: agentToClaudeMd,
    },
    {
      key: "codex",
      label: "Codex",
      dir: join(resolveNativeHarnessDir("codex", options.userHome), "agents"),
      extension: "toml",
      render: agentToCodexToml,
    },
    {
      key: "opencode",
      label: "OpenCode",
      dir: join(resolveNativeHarnessDir("opencode", options.userHome), "agents"),
      extension: "md",
      render: agentToOpenCodeMd,
    },
  ];

  let claude = true;
  let codex = true;
  let opencode = true;

  const setTargetFailed = (targetKey: NativeAgentProjectionTarget["key"]): void => {
    if (targetKey === "claude") {
      claude = false;
      return;
    }
    if (targetKey === "codex") {
      codex = false;
      return;
    }
    opencode = false;
  };

  for (const target of targets) {
    if (isNativeProjectionHarnessDisabled(options, target.key)) {
      outcomes.push(...agents.map((agent) => ({
        targetId: `${target.key}-agent:${agent.name}`,
        path: join(target.dir, `${agent.name}.${target.extension}`),
        status: "skipped" as const,
        reason: `${target.label} harness is disabled`,
      })));
      continue;
    }
    try {
      if (!options.dryRun) mkdirSync(target.dir, { recursive: true });
    } catch (error) {
      setTargetFailed(target.key);
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${target.label} mkdir failed: ${reason}`);
      outcomes.push({ targetId: `${target.key}-agent-directory`, path: target.dir, status: "failed", reason });
    }

    const staleAgentResult = pruneOmittedNativeAgentProjections({
      target,
      agents,
      kilnDir,
      installState,
      options,
    });
    installState = staleAgentResult.installState;
    outcomes.push(...staleAgentResult.outcomes);
    if (staleAgentResult.errors.length > 0) {
      setTargetFailed(target.key);
      errors.push(...staleAgentResult.errors);
    }

    for (const agent of agents) {
      const result = syncAgentFile(agent, target, kilnDir, installState, { ...options, resolveRouteAdmission });
      outcomes.push(result.outcome);
      if (result.unavailable) unavailable.push(result.unavailable);
      if (result.communication) communication.push(result.communication);
      if (!result.ok) {
        setTargetFailed(target.key);
        errors.push(`${target.label} agent "${agent.name}" failed: ${result.error ?? "unknown error"}`);
        continue;
      }
      if (result.snapshot) {
        installState = upsertNativeProjectionTargetState(installState, result.snapshot);
        synced += 1;
      }
      if (result.removedTargetId) {
        if (!options.dryRun) {
          installState = removeNativeProjectionTargetState(installState, result.removedTargetId);
        }
      }
    }
  }

  if (!options.dryRun) writeNativeProjectionInstallState(kilnDir, installState);

  return { claude, codex, opencode, synced, errors, outcomes, unavailable, communication };
}

function syncAgentFile(
  agent: KilnAgentDefinition,
  target: NativeAgentProjectionTarget,
  kilnDir: string,
  installState: NativeProjectionInstallState,
  options: NativeAgentProjectionOptions,
): NativeAgentFileSyncResult {
  const filePath = join(target.dir, `${agent.name}.${target.extension}`);
  const targetId = `${target.key}-agent:${agent.name}`;
  const identity = {
    targetId,
    filePath,
    harness: target.key,
    sourceIdentity: `agent:${agent.name}`,
  } as const;
  if (!isSafeProjectionPathComponent(agent.name) || !resolveProjectionPathWithin(target.dir, filePath)) {
    return {
      ok: false,
      error: `unsafe managed agent projection path: ${agent.name}`,
      outcome: {
        targetId,
        path: filePath,
        status: "blocked",
        reason: `unsafe managed agent projection path: ${agent.name}`,
      },
    };
  }
  const decision = decideNativeAgentProjection({
    agent,
    harness: target.key,
    admission: agent.providerRoute ? options.resolveRouteAdmission?.({
      agent,
      ...(agent.routeId ? { routeId: agent.routeId } : {}), providerId: agent.providerRoute.providerId,
      ...(agent.providerRoute.model ? { model: agent.providerRoute.model } : {}), harness: target.key,
    }) : undefined,
  });
  if (decision.kind !== "project") {
    const unavailable = { targetId, agentName: agent.name, harness: target.key, decision };
    let managedTarget = installState.targets[targetId];
    let observedContent: string | Uint8Array | undefined;
    if (!isFullyOwnedNativeProjectionFile(managedTarget, identity) && existsSync(filePath)) {
      observedContent = readFileSync(filePath);
      managedTarget = adoptLegacyNativeProjectionFile({
        target: managedTarget,
        currentContent: observedContent,
        expected: identity,
        harnessRoot: target.dir,
      });
    }
    const ownedTarget = managedTarget;
    if (!ownedTarget || !isFullyOwnedNativeProjectionFile(ownedTarget, identity)) {
      return {
        ok: true,
        outcome: {
          targetId,
          path: filePath,
          status: "skipped",
          reason: nativeProjectionUnavailableReason(decision.reason),
        },
        unavailable,
      };
    }
    try {
      if (existsSync(filePath)) {
        const drift = detectNativeProjectionFileDrift({
          targetId,
          state: {
            version: 1,
            targets: { [targetId]: ownedTarget },
          },
          currentContent: observedContent ?? readFileSync(filePath),
        });
        if (drift) {
          return {
            ok: false,
            error: `managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
            outcome: {
              targetId,
              path: filePath,
              status: "blocked",
              reason: `managed drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
            },
            unavailable,
          };
        }
      }
      if (options.dryRun) {
        return {
          ok: true,
          removedTargetId: targetId,
          outcome: {
            targetId,
            path: filePath,
            status: "planned",
            reason: "remove unavailable managed agent projection",
          },
          unavailable,
        };
      }
      if (existsSync(filePath)) {
        backupNativeProjectionFile({ kilnDir, targetId, filePath });
        unlinkSync(filePath);
      }
      return {
        ok: true,
        removedTargetId: targetId,
        outcome: { targetId, path: filePath, status: "removed", reason: "remove unavailable managed agent projection" },
        unavailable,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: reason,
        outcome: { targetId, path: filePath, status: "failed", reason },
        unavailable,
      };
    }
  }

  try {
    const communicationResolution = resolveNativeAgentCommunication(
      agent,
      target.key,
      decision.nativeModel,
      options.communicationCandidates,
    );
    const communication = { targetId, agentName: agent.name, harness: target.key, resolution: communicationResolution };
    if (existsSync(filePath)) {
      const drift = detectNativeProjectionFileDrift({
        targetId,
        state: installState,
        currentContent: readFileSync(filePath, "utf-8"),
      });
      if (drift && !options.force) {
        return {
          ok: false,
          error: `managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
          outcome: {
            targetId,
            path: filePath,
            status: "blocked",
            reason: `managed drift detected: ${describeProjectionDrift(drift.driftedFields)}`,
          },
          communication,
        };
      }
    }

    const content = target.render(agent, decision.nativeModel, communicationResolution);
    const snapshot = createNativeProjectionFileSnapshot({ ...identity, content, communicationResolution });
    if (options.dryRun) {
      return {
        ok: true,
        outcome: { targetId, path: filePath, status: "planned", reason: "write projected agent file content" },
        communication,
      };
    }
    backupNativeProjectionFile({ kilnDir, targetId, filePath });
    writeFileSync(filePath, content, "utf-8");
    return {
      ok: true,
      snapshot,
      outcome: { targetId, path: filePath, status: "written" },
      communication,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: reason,
      outcome: { targetId, path: filePath, status: "failed", reason },
    };
  }
}

export function resolveNativeAgentCommunication(
  agent: KilnAgentDefinition,
  harness: "claude" | "codex" | "opencode",
  nativeModel?: string,
  inheritedCandidates: readonly CommunicationIntentCandidate[] = [],
): CommunicationResolution {
  const intent = resolveCommunicationIntent([
    ...inheritedCandidates,
    ...(agent.communication ? [{ source: "agent-profile" as const, intent: agent.communication }] : []),
  ]);
  const provider = harness;
  const model = nativeModel ?? "provider-default";
  return resolveNativeCommunication({
    intent,
    harness: provider,
    model,
  });
}

function pruneOmittedNativeAgentProjections(input: {
  readonly target: NativeAgentProjectionTarget;
  readonly agents: readonly KilnAgentDefinition[];
  readonly kilnDir: string;
  readonly installState: NativeProjectionInstallState;
  readonly options: NativeAgentProjectionOptions;
}): {
  readonly installState: NativeProjectionInstallState;
  readonly errors: readonly string[];
  readonly outcomes: readonly ProjectionOutcome[];
} {
  const prefix = `${input.target.key}-agent:`;
  const currentNames = new Set(input.agents.map((agent) => agent.name));
  const errors: string[] = [];
  const outcomes: ProjectionOutcome[] = [];
  let installState = input.installState;

  for (const [targetId, targetState] of Object.entries(input.installState.targets)) {
    if (!targetId.startsWith(prefix)) continue;
    const agentName = targetId.slice(prefix.length);
    if (currentNames.has(agentName)) continue;
    const filePath = targetState.filePath;
    const identity = {
      targetId,
      filePath,
      harness: input.target.key,
      sourceIdentity: `agent:${agentName}`,
    } as const;
    if (!isSafeProjectionPathComponent(agentName)
      || !resolveProjectionPathWithin(input.target.dir, filePath)) {
      continue;
    }
    let managedTarget: NativeProjectionTargetState | undefined = targetState;
    let observedContent: string | Uint8Array | undefined;
    if (!isFullyOwnedNativeProjectionFile(managedTarget, identity) && existsSync(filePath)) {
      observedContent = readFileSync(filePath);
      managedTarget = adoptLegacyNativeProjectionFile({
        target: managedTarget,
        currentContent: observedContent,
        expected: identity,
        harnessRoot: input.target.dir,
      });
    }
    const ownedTarget = managedTarget;
    if (!ownedTarget || !isFullyOwnedNativeProjectionFile(ownedTarget, identity)) continue;
    try {
      if (existsSync(filePath)) {
        const drift = detectNativeProjectionFileDrift({
          targetId,
          state: {
            version: 1,
            targets: { [targetId]: ownedTarget },
          },
          currentContent: observedContent ?? readFileSync(filePath),
        });
        if (drift) {
          const reason = `managed file drift detected: ${describeProjectionDrift(drift.driftedFields)}`;
          errors.push(`${input.target.label} omitted agent "${agentName}" failed: ${reason}`);
          outcomes.push({ targetId, path: filePath, status: "blocked", reason });
          continue;
        }
      }
      if (input.options.dryRun) {
        outcomes.push({
          targetId,
          path: filePath,
          status: "planned",
          reason: "remove omitted managed agent projection",
        });
        continue;
      }
      if (existsSync(filePath)) {
        backupNativeProjectionFile({ kilnDir: input.kilnDir, targetId, filePath });
        unlinkSync(filePath);
      }
      installState = removeNativeProjectionTargetState(installState, targetId);
      outcomes.push({ targetId, path: filePath, status: "removed", reason: "remove omitted managed agent projection" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${input.target.label} omitted agent "${agentName}" failed: ${reason}`);
      outcomes.push({ targetId, path: filePath, status: "failed", reason });
    }
  }

  return { installState, errors, outcomes };
}

function nativeProjectionUnavailableReason(
  reason: import("./native-agent-projection-decision.js").NativeProjectionUnavailableReason,
): string {
  if (reason.kind === "transport") return `native projection transport unavailable: ${reason.code}`;
  return `managed route admission unavailable: ${reason.reasons.map((rejection) => rejection.code).join(", ")}`;
}
