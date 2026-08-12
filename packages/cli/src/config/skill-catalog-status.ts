import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { parse } from "yaml";
import { parse as parseToml } from "smol-toml";
import {
  KILN_CORE_BUILTIN_SKILLS,
  loadSkillMdIndex,
  renderSkillMarkdown,
  resolveKilnCoreBuiltinSkills,
  type SkillIndex,
  canonicalSkillIdentity,
  digestSkillPackage,
} from "@kilnai/core";
import type {
  KilnSkillCatalogProjectionStatus,
  KilnSkillCatalogSnapshot,
  KilnSkillCatalogSnapshotEntry,
  KilnSkillOriginKind,
  KilnSkillProjectionTargetSnapshot,
} from "@kilnai/gateway-contracts";
import type { KilnYamlSkillsConfig } from "../kiln-yaml-types.js";
import { stripJsonComments } from "./json-comments.js";
import {
  adoptLegacyNativeProjectionFile,
  detectNativeProjectionFileDrift,
  isFullyOwnedNativeProjectionFile,
  type NativeProjectionInstallState,
  type NativeProjectionTargetState,
  nativeProjectionFileMatchesDesired,
  readNativeProjectionInstallState,
} from "./native-projection-state.js";
import { NATIVE_SKILL_TARGETS } from "./native-skill-targets.js";
import {
  canonicalSkillKey,
  isSafeProjectionPathComponent,
  isSafeProjectionRelativePath,
  resolveProjectionPathWithin,
} from "./native-projection-paths.js";
import { renderSkillVisibility, resolveSkillVisibility } from "./skill-visibility.js";
import {
  collectSkillSourceInventory,
  defaultCodexPluginProvider,
  normalizeSkillInventoryPath,
  type SkillInventoryCommandRunner,
  type SkillPluginProvider,
} from "./skill-source-inventory.js";
import { compileCodexExternalSkillExposure, computeCodexExternalInventoryFingerprint } from "./external-skill-exposure.js";

export interface ReadSkillCatalogStatusOptions {
  readonly projectPath: string;
  readonly userHome?: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
  readonly pluginProvider?: SkillPluginProvider;
  readonly commandRunner?: SkillInventoryCommandRunner;
  readonly cwd?: string;
  /** Internal evidence hook; absolute paths are deliberately excluded from the status contract. */
  readonly onCandidateResolved?: (sourceId: string, absoluteSkillFilePath: string) => void;
}

export function readGlobalExternalSkillInventory(options: Pick<ReadSkillCatalogStatusOptions,
  "userHome" | "pluginProvider" | "commandRunner" | "onCandidateResolved">) {
  const userHome = options.userHome ?? homedir();
  const absolutePathBySourceId = new Map<string, string>();
  const inventory = collectSkillSourceInventory({
    roots: [
      { id: "shared-agents:user", sourceKind: "shared-agents", root: join(userHome, ".agents", "skills"), relationship: "external", exposureScope: "user", applicableHarnesses: ["codex", "opencode"] },
      { id: "system:codex", sourceKind: "system", root: join(userHome, ".codex", "skills", ".system"), relationship: "external", exposureScope: "harness" },
    ],
    ...(options.pluginProvider ? { pluginProvider: options.pluginProvider } : {}),
    ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
    trustedRealRoots: [join(userHome, ".agents", "skills")],
    onCandidateResolved: (sourceId, absolutePath) => {
      absolutePathBySourceId.set(sourceId, absolutePath);
      options.onCandidateResolved?.(sourceId, absolutePath);
    },
  });
  return { inventory, absolutePathBySourceId };
}

interface SkillSourceEntry {
  readonly index: SkillIndex;
  readonly origin: KilnSkillOriginKind;
  readonly sourcePath: string;
  readonly desiredVisibility: "implicit" | "explicit-only" | "disabled";
}

export function readSkillCatalogStatus(
  options: ReadSkillCatalogStatusOptions,
): KilnSkillCatalogSnapshot {
  const userHome = options.userHome ?? homedir();
  const configured = discoverConfiguredSkills({
    projectPath: options.projectPath,
    userHome,
    skillConfig: options.skillConfig,
  });
  const configuredNames = new Set(configured.map((entry) => canonicalSkillKey(entry.index.name)));
  const installState = readNativeProjectionInstallState(join(options.projectPath, ".kiln"));
  const entries: KilnSkillCatalogSnapshotEntry[] = [
    ...configured.map((entry) => projectConfiguredSkill(entry, userHome, installState, options.projectPath)),
    ...discoverUnmanagedNativeSkills(userHome, configuredNames),
  ];
  const builtinCandidates = configured.filter((entry) => entry.origin === "builtin").map((entry) => {
    const builtin = KILN_CORE_BUILTIN_SKILLS.find((skill) => skill.name === entry.index.name);
    const content = Buffer.from(builtin ? renderSkillMarkdown(builtin) : entry.index.description, "utf8");
    const canonicalName = canonicalSkillIdentity(entry.index.name);
    return {
      name: entry.index.name,
      canonicalName,
      sourceKind: "builtin" as const,
      sourceId: `builtin:${canonicalName}`,
      exposureScope: "builtin" as const,
      sourcePath: `builtin/${canonicalName}/SKILL.md`,
      relationship: "canonical" as const,
      packageDigest: digestSkillPackage([{ path: "SKILL.md", content }]),
      descriptionBytes: Buffer.byteLength(entry.index.description, "utf8"),
      applicableHarnesses: ["claude", "codex", "opencode"] as const,
      effectiveVisibility: entry.desiredVisibility,
    };
  });
  const managedPaths = (harness: "claude" | "codex" | "opencode", targetRoot: string) =>
    managedSkillProjectionPaths(installState, harness, targetRoot);
  const codexRoot = join(userHome, ".codex", "skills");
  const claudeRoot = join(userHome, ".claude", "skills");
  const openCodeRoot = join(userHome, ".config", "opencode", "skills");
  const codexProjectAgentRoots = discoverAgentsAncestry(options.cwd ?? options.projectPath, options.projectPath);
  let pluginInventory: ReturnType<SkillPluginProvider> | undefined;
  const pluginProvider: SkillPluginProvider = () => pluginInventory ??= options.pluginProvider
    ? options.pluginProvider()
    : defaultCodexPluginProvider(options.commandRunner);
  const absolutePathBySourceId = new Map<string, string>();
  const collectedInventory = collectSkillSourceInventory({
    roots: [
      { id: "kiln-user", sourceKind: "kiln-user", root: join(userHome, ".kiln", "skills"), relationship: "canonical" },
      { id: "kiln-project", sourceKind: "kiln-project", root: join(options.projectPath, ".kiln", "skills"), relationship: "canonical" },
      { id: "shared-agents:user", sourceKind: "shared-agents", root: join(userHome, ".agents", "skills"), relationship: "external", applicableHarnesses: ["codex", "opencode"] },
      ...codexProjectAgentRoots.map((root, index) => ({ id: `shared-agents:project:${index}`, sourceKind: "shared-agents" as const, root, relationship: "external" as const, exposureScope: "project" as const, applicableHarnesses: ["codex", "opencode"] as const })),
      { id: "system:codex", sourceKind: "system", root: join(userHome, ".codex", "skills", ".system"), relationship: "external" },
      { id: "native:codex", sourceKind: "native-harness", root: codexRoot, relationship: "external", managedSkillPaths: managedPaths("codex", codexRoot), applicableHarnesses: ["codex"], excludedTopLevelNames: new Set([".system"]), harness: "codex" },
      { id: "native:claude", sourceKind: "native-harness", root: claudeRoot, relationship: "external", managedSkillPaths: managedPaths("claude", claudeRoot), applicableHarnesses: ["claude"], harness: "claude" },
      { id: "native:opencode", sourceKind: "native-harness", root: openCodeRoot, relationship: "external", managedSkillPaths: managedPaths("opencode", openCodeRoot), applicableHarnesses: ["opencode"], harness: "opencode" },
    ],
    pluginProvider,
    virtualCandidates: builtinCandidates,
    trustedRealRoots: [
      join(userHome, ".kiln", "skills"),
      join(options.projectPath, ".kiln", "skills"),
      join(userHome, ".agents", "skills"),
      ...codexProjectAgentRoots,
    ],
    onCandidateResolved: (sourceId, absolutePath) => {
      absolutePathBySourceId.set(sourceId, absolutePath);
      options.onCandidateResolved?.(sourceId, absolutePath);
    },
  });
  const candidates = collectedInventory.candidates.map((candidate) => candidate.relationship === "canonical"
    ? { ...candidate, effectiveVisibility: resolveSkillVisibility(candidate.canonicalName, options.skillConfig) }
    : candidate);
  const implicitCandidates = candidates.filter((candidate) =>
    candidate.relationship !== "managed-projection"
    && (candidate.relationship === "canonical"
      ? resolveSkillVisibility(candidate.canonicalName, options.skillConfig) === "implicit"
      : candidate.effectiveVisibility === "implicit")
  );
  const inventoryBase = { ...collectedInventory, candidates, harnesses: collectedInventory.harnesses.map((summary) => {
    const candidates = implicitCandidates.filter((candidate) => candidate.applicableHarnesses.includes(summary.harness));
    return { ...summary, candidateCount: candidates.length, descriptionBytes: candidates.reduce((total, candidate) => total + candidate.descriptionBytes, 0) };
  }) };
  const globalExposureInventory = readGlobalExternalSkillInventory({ ...options, pluginProvider });
  const inventory = {
    ...inventoryBase,
    externalExposure: externalExposureEvidence(globalExposureInventory.inventory, options.skillConfig,
      globalExposureInventory.absolutePathBySourceId, userHome),
  };

  return {
    entries: entries.sort((left, right) =>
      left.name.localeCompare(right.name) || left.origin.localeCompare(right.origin)
    ),
    inventory,
  };
}

function externalExposureEvidence(
  inventory: NonNullable<KilnSkillCatalogSnapshot["inventory"]>,
  skillConfig: KilnYamlSkillsConfig | null | undefined,
  absolutePathBySourceId: ReadonlyMap<string, string>,
  userHome: string,
): readonly {
  readonly harness: "claude" | "codex" | "opencode";
  readonly status: "not-configured" | "current" | "stale" | "blocked" | "unsupported";
  readonly realizedImplicit: number;
  readonly suppressed: number;
  readonly fingerprint?: string;
  readonly freshness: "current" | "stale" | "unknown";
  readonly reason: string;
}[] {
  const policy = skillConfig?.externalCatalog;
  const unsupported = (["claude", "opencode"] as const).map((harness) => ({
    harness,
    status: policy?.harnesses[harness] ? "unsupported" as const : "not-configured" as const,
    realizedImplicit: inventory.candidates.filter((candidate) => candidate.relationship === "external"
      && candidate.applicableHarnesses.includes(harness) && candidate.effectiveVisibility === "implicit").length,
    suppressed: 0,
    freshness: "unknown" as const,
    reason: policy?.harnesses[harness]
      ? "This build has no exact external exposure adapter for this harness."
      : "No reviewed external exposure policy is configured for this harness.",
  }));
  if (!policy?.harnesses.codex) return [{
    harness: "codex", status: "not-configured", realizedImplicit: inventory.candidates.filter((candidate) =>
      candidate.relationship === "external" && candidate.applicableHarnesses.includes("codex") && candidate.effectiveVisibility === "implicit").length,
    suppressed: 0,
    ...(inventory.complete ? { fingerprint: computeCodexExternalInventoryFingerprint(inventory.candidates.filter((candidate) =>
      candidate.relationship === "external" && candidate.applicableHarnesses.includes("codex")
      && candidate.exposureScope !== "project" && candidate.effectiveVisibility === "implicit")) } : {}),
    freshness: "unknown", reason: "No reviewed external exposure policy is configured for Codex; use this current complete inventory fingerprint when creating a reviewed policy.",
  }, ...unsupported];
  try {
    const compiled = compileCodexExternalSkillExposure({ inventory, policy, absolutePathBySourceId });
    const configPath = join(userHome, ".codex", "config.toml");
    let persistedInventoryFingerprint: string | undefined;
    let persistedPolicyFingerprint: string | undefined;
    let persistedAdapterRevision: string | undefined;
    let actualItems: readonly unknown[] = [];
    if (existsSync(configPath)) {
      const document = parseToml(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const kiln = document.kiln as Record<string, unknown> | undefined;
      const evidence = kiln?.external_skill_catalog as Record<string, unknown> | undefined;
      if (typeof evidence?.inventory_fingerprint === "string") persistedInventoryFingerprint = evidence.inventory_fingerprint;
      if (typeof evidence?.policy_fingerprint === "string") persistedPolicyFingerprint = evidence.policy_fingerprint;
      if (typeof evidence?.adapter_revision === "string") persistedAdapterRevision = evidence.adapter_revision;
      const skills = document.skills as Record<string, unknown> | undefined;
      actualItems = Array.isArray(skills?.config) ? skills.config : [];
    }
    const nameByPath = new Map(inventory.candidates.flatMap((candidate) => {
      const path = absolutePathBySourceId.get(candidate.sourceId);
      return path ? [[path, candidate.name] as const] : [];
    }));
    const effectiveEnabled = (path: string): boolean | undefined => {
      let enabled: boolean | undefined;
      const name = nameByPath.get(path);
      for (const value of actualItems) {
        const item = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
        if ((item.path === path || name !== undefined && item.name === name) && typeof item.enabled === "boolean") enabled = item.enabled;
      }
      return enabled;
    };
    const actualHasAllDisabledItems = compiled.disabledItems.every((desired) => effectiveEnabled(desired.path) === false);
    const current = persistedInventoryFingerprint === compiled.fingerprint
      && persistedPolicyFingerprint === compiled.policyFingerprint
      && persistedAdapterRevision === "codex-skills-config-path-v1"
      && actualHasAllDisabledItems;
    const keptPaths = policy.harnesses.codex.keepImplicit.map((decision) => absolutePathBySourceId.get(decision.sourceId)).filter((path): path is string => path !== undefined);
    const realizedImplicit = keptPaths.filter((path) => effectiveEnabled(path) !== false).length;
    const suppressed = [...compiled.disabledItems.map((item) => item.path), ...keptPaths]
      .filter((path) => effectiveEnabled(path) === false).length;
    return [{
      harness: "codex", status: current ? "current" : "stale",
      realizedImplicit,
      suppressed, fingerprint: compiled.fingerprint,
      freshness: current ? "current" : "stale",
      reason: current ? "Native Codex exposure matches the reviewed inventory, policy, adapter, and actual disabled paths."
        : `Native Codex exposure is stale or unproven (expected inventory ${policy.harnesses.codex.expectedFingerprint}, current ${compiled.fingerprint}).`,
    }, ...unsupported];
  } catch (error) {
    const currentFingerprint = computeCodexExternalInventoryFingerprint(inventory.candidates.filter((candidate) =>
      candidate.relationship === "external" && candidate.applicableHarnesses.includes("codex")
      && candidate.exposureScope !== "project" && candidate.effectiveVisibility === "implicit"));
    const fingerprintDrift = policy.harnesses.codex.expectedFingerprint !== currentFingerprint;
    return [{ harness: "codex", status: "blocked", realizedImplicit: 0, suppressed: 0, freshness: "unknown",
      ...(fingerprintDrift ? { status: "stale" as const, freshness: "stale" as const, fingerprint: currentFingerprint } : {}),
      reason: fingerprintDrift
        ? `Reviewed inventory fingerprint is stale (expected ${policy.harnesses.codex.expectedFingerprint}, current ${currentFingerprint}).`
        : error instanceof Error ? error.message : String(error) }, ...unsupported];
  }
}

function managedSkillProjectionPaths(
  installState: NativeProjectionInstallState,
  harness: "claude" | "codex" | "opencode",
  targetRoot: string,
): ReadonlySet<string> {
  return new Set(Object.entries(installState.targets).flatMap(([key, state]) => {
    const match = new RegExp(`^${harness}-skill:([^/]+)/SKILL\\.md$`, "i").exec(key);
    if (!match || key !== state.targetId) return [];
    const skillName = match[1];
    if (!skillName || !isSafeProjectionPathComponent(skillName)) return [];
    const expectedPath = resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, "SKILL.md"));
    if (!expectedPath) return [];
    const sourceIdentity = state.sourceIdentity ?? "";
    if (!new RegExp(`^(builtin|user|project):${canonicalSkillKey(skillName)}/SKILL\\.md$`, "i").test(sourceIdentity)) return [];
    const expected = { targetId: key, filePath: expectedPath, harness, sourceIdentity };
    return isFullyOwnedNativeProjectionFile(state, expected)
      ? [normalizeSkillInventoryPath(expectedPath)]
      : [];
  }));
}

function discoverAgentsAncestry(cwd: string, projectRoot: string): readonly string[] {
  const roots: string[] = [];
  let current = cwd;
  const normalizedProject = normalizeSkillInventoryPath(projectRoot);
  while (true) {
    roots.push(join(current, ".agents", "skills"));
    const normalizedCurrent = normalizeSkillInventoryPath(current);
    if (normalizedCurrent === normalizedProject) break;
    const parent = dirname(current);
    if (parent === current || !normalizedCurrent.startsWith(`${normalizedProject}/`)) break;
    current = parent;
  }
  return roots.reverse();
}

function discoverConfiguredSkills(input: {
  readonly projectPath: string;
  readonly userHome: string;
  readonly skillConfig?: KilnYamlSkillsConfig | null;
}): readonly SkillSourceEntry[] {
  const discovered = new Map<string, SkillSourceEntry>();
  addSkillDirectory(discovered, join(input.userHome, ".kiln", "skills"), "user", input.skillConfig);
  addSkillDirectory(discovered, join(input.projectPath, ".kiln", "skills"), "project", input.skillConfig);

  for (const skill of resolveKilnCoreBuiltinSkills(input.skillConfig?.builtin)) {
    if (!isSafeProjectionPathComponent(skill.name)) continue;
    const key = canonicalSkillKey(skill.name);
    if (!discovered.has(key)) {
      discovered.set(key, {
        index: skill,
        origin: "builtin",
        sourcePath: skill.filePath,
        desiredVisibility: resolveSkillVisibility(skill.name, input.skillConfig),
      });
    }
  }

  return [...discovered.values()];
}

function addSkillDirectory(
  discovered: Map<string, SkillSourceEntry>,
  dirPath: string,
  origin: "user" | "project",
  skillConfig?: KilnYamlSkillsConfig | null,
): void {
  for (const skillPath of readSkillMarkdownPaths(dirPath)) {
    try {
      const index = loadSkillMdIndex(skillPath);
      if (!isSafeProjectionPathComponent(index.name)) continue;
      const skillDirectory = dirname(skillPath);
      if (skillDirectory !== dirPath
        && (!isSafeProjectionPathComponent(basename(skillDirectory))
          || canonicalSkillKey(basename(skillDirectory)) !== canonicalSkillKey(index.name))) {
        continue;
      }
      discovered.set(canonicalSkillKey(index.name), {
        index,
        origin,
        sourcePath: skillPath,
        desiredVisibility: resolveSkillVisibility(index.name, skillConfig),
      });
    } catch {
      // Invalid skill files are outside the admitted catalog.
    }
  }
}

function readSkillMarkdownPaths(dirPath: string): readonly string[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
      if (entry.isDirectory()) {
        if (!isSafeProjectionPathComponent(entry.name)) return [];
        const skillMd = readDirectorySkillMarkdownPath(join(dirPath, entry.name));
        return skillMd ? [skillMd] : [];
      }
      return entry.name.toLowerCase().endsWith(".md") && isSafeProjectionPathComponent(entry.name)
        ? [join(dirPath, entry.name)]
        : [];
    });
  } catch {
    return [];
  }
}

function readDirectorySkillMarkdownPath(skillDir: string): string | undefined {
  try {
    const file = readdirSync(skillDir, { withFileTypes: true })
      .find((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
    return file ? join(skillDir, file.name) : undefined;
  } catch {
    return undefined;
  }
}

function projectConfiguredSkill(
  source: SkillSourceEntry,
  userHome: string,
  installState: NativeProjectionInstallState,
  projectPath: string,
): KilnSkillCatalogSnapshotEntry {
  const isBuiltin = source.origin === "builtin"
    || KILN_CORE_BUILTIN_SKILLS.some((skill) => skill.name === source.index.name);
  return {
    name: source.index.name,
    description: source.index.description,
    origin: source.origin,
    configured: true,
    builtIn: isBuiltin,
    sourcePath: source.sourcePath,
    desiredVisibility: source.desiredVisibility,
    tools: source.index.tools,
    tags: source.index.tags,
    projections: NATIVE_SKILL_TARGETS.map((target) =>
      readConfiguredProjectionStatus(
        target.target,
        target.displayName,
        target.dir(userHome),
        source,
        installState,
        projectPath,
      )
    ),
    admission: source.desiredVisibility === "disabled"
      ? {
          state: "blocked",
          reason: "Configured Kiln skill is disabled by canonical catalog visibility policy.",
        }
      : {
          state: "available",
          reason: "Configured Kiln skill. Admission still depends on explicit request, agent profile defaults, or auto skill selection.",
        },
    ...(source.desiredVisibility === "disabled"
      ? { omissionReason: "Disabled by skills.visibility policy." }
      : {}),
  };
}

function readConfiguredProjectionStatus(
  target: KilnSkillProjectionTargetSnapshot["target"],
  displayName: string,
  targetRoot: string,
  source: SkillSourceEntry,
  installState: NativeProjectionInstallState,
  projectPath: string,
): KilnSkillProjectionTargetSnapshot {
  const skillName = source.index.name;
  const fileNames = projectionFileNames(source, target);
  const primaryFileName = fileNames.find((fileName) => fileName.toLowerCase() === "skill.md") ?? fileNames[0] ?? "SKILL.md";
  if (source.desiredVisibility === "disabled") {
    const observedVisibility = readEffectiveNativeSkillVisibility(target, targetRoot, skillName);
    const managedPrefix = `${target}-skill:${canonicalSkillKey(skillName)}/`;
    const managedProjectionRemains = Object.entries(installState.targets).some(([targetId, state]) =>
      targetId.startsWith(managedPrefix) && existsSync(state.filePath)
    );
    const nativeStates = fileNames.map((fileName) => {
      const path = resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, fileName));
      if (!path || !existsSync(path)) return "absent" as const;
      const targetId = `${target}-skill:${canonicalSkillKey(skillName)}/${fileName}`;
      return findSkillProjectionState(installState, targetId) ? "managed" as const : "unmanaged" as const;
    });
    const status: KilnSkillCatalogProjectionStatus = nativeStates.includes("unmanaged")
      ? "unmanaged-native"
      : managedProjectionRemains || nativeStates.includes("managed")
        ? "drifted"
        : "projected";
    return {
      target,
      displayName,
      path: resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, primaryFileName))
        ?? join(targetRoot, skillName, primaryFileName),
      status,
      effectiveVisibility: observedVisibility,
      visibilityCapability: observedVisibility === "disabled" ? "exact" : "unsupported",
      visibilityReason: observedVisibility === "disabled"
        ? "No native projection is present, matching disabled visibility."
        : `Native harness still exposes the skill as ${observedVisibility} despite disabled visibility.`,
    };
  }
  const statuses = fileNames.map((fileName) => {
    if (!isSafeProjectionPathComponent(skillName) || !isSafeProjectionRelativePath(fileName)) {
      return "missing" as const;
    }
    const path = resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, fileName));
    const targetId = `${target}-skill:${canonicalSkillKey(skillName)}/${fileName}`;
    if (!path) return "missing" as const;
    const targetState = findSkillProjectionState(installState, targetId);
    return readProjectionStatus(
      targetId,
      path,
      targetState ? { version: 1, targets: { [targetId]: targetState } } : installState,
      targetState !== undefined,
      canonicalSkillProjectionContent(source, fileName, target),
      {
        targetId,
        filePath: path,
        harness: target,
        sourceIdentity: `${source.origin}:${canonicalSkillKey(skillName)}/${fileName}`,
      },
      targetRoot,
    );
  });
  const observedVisibility = readEffectiveNativeSkillVisibility(target, targetRoot, skillName);
  const openCodeExplicitOnlyUnsupported = source.desiredVisibility === "explicit-only" && target === "opencode";
  const openCodeDenyEffective = openCodeExplicitOnlyUnsupported && hasOpenCodeSkillDeny(targetRoot, skillName, projectPath);
  const visibilityCapability = openCodeExplicitOnlyUnsupported || observedVisibility !== source.desiredVisibility
    ? "unsupported" as const
    : "exact" as const;
  return {
    target,
    displayName,
    path: resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, primaryFileName))
      ?? join(targetRoot, skillName, primaryFileName),
    status: aggregateProjectionStatus(statuses),
    effectiveVisibility: observedVisibility,
    visibilityCapability,
    visibilityReason: visibilityCapability === "exact"
      ? `Harness projection represents ${source.desiredVisibility} visibility exactly.`
      : openCodeExplicitOnlyUnsupported && observedVisibility === "disabled"
        ? openCodeDenyEffective
          ? "Stable OpenCode cannot preserve direct invocation; the observed default merged configuration denies the skill fail closed, while agent and session overrides remain unproven."
          : "Current OpenCode projection cannot prove explicit-only enforcement; a same-name copy may remain available."
        : `Native harness exposes ${observedVisibility}; desired visibility is ${source.desiredVisibility}.`,
  };
}

function hasOpenCodeSkillDeny(targetRoot: string, skillName: string, projectPath: string): boolean {
  let effective: unknown;
  for (const path of [join(dirname(targetRoot), "opencode.json"), join(projectPath, "opencode.json"), join(projectPath, ".opencode", "opencode.json")]) try {
    const config = JSON.parse(stripJsonComments(readFileSync(path, "utf8"))) as Record<string, unknown>;
    const permission = typeof config.permission === "object" && config.permission !== null ? config.permission as Record<string, unknown> : {};
    if (typeof permission.skill === "string") { effective = permission.skill; continue; }
    const skill = typeof permission.skill === "object" && permission.skill !== null ? permission.skill as Record<string, unknown> : {};
    const matched = Object.entries(skill)
      .filter(([pattern]) => openCodeWildcardMatch(skillName, pattern))
      .at(-1)?.[1];
    if (matched !== undefined) effective = matched;
  } catch { /* absent/unreadable layer supplies no proof */ }
  return effective === "deny";
}

function openCodeWildcardMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s").test(value);
}

function readEffectiveNativeSkillVisibility(
  target: "claude" | "codex" | "opencode",
  targetRoot: string,
  skillName: string,
): "implicit" | "explicit-only" | "disabled" {
  const skillPath = resolveProjectionPathWithin(targetRoot, join(targetRoot, skillName, "SKILL.md"));
  if (!skillPath || !existsSync(skillPath)) return "disabled";
  try {
    if (target === "codex") {
      const metadataPath = resolveProjectionPathWithin(
        targetRoot,
        join(targetRoot, skillName, "agents", "openai.yaml"),
      );
      if (!metadataPath || !existsSync(metadataPath)) return "implicit";
      const metadata = parse(readFileSync(metadataPath, "utf8")) as {
        readonly policy?: { readonly allow_implicit_invocation?: unknown };
      } | null;
      return metadata?.policy?.allow_implicit_invocation === false ? "explicit-only" : "implicit";
    }
    const content = readFileSync(skillPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    const frontmatter = match
      ? parse(match[1] ?? "") as Record<string, unknown> | null
      : null;
    if (target === "claude") {
      return frontmatter?.["disable-model-invocation"] === true ? "explicit-only" : "implicit";
    }
    const metadata = frontmatter?.metadata;
    const autoInvoke = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)["opencode/autoinvoke"]
      : undefined;
    return autoInvoke === false || autoInvoke === "false" ? "explicit-only" : "implicit";
  } catch {
    return "implicit";
  }
}

function canonicalSkillProjectionContent(
  source: SkillSourceEntry,
  fileName: string,
  target: "claude" | "codex" | "opencode",
): string | Uint8Array | undefined {
  if (source.origin === "builtin") {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === source.index.name);
    if (!skill) return undefined;
    return renderSkillVisibility(
      target,
      source.desiredVisibility,
      [{ fileName: "SKILL.md", content: renderSkillMarkdown(skill) }],
    ).find((file) => file.fileName === fileName)?.content;
  }

  const sourcePath = canonicalSkillKey(basename(dirname(source.index.filePath))) === canonicalSkillKey(source.index.name)
    ? join(dirname(source.index.filePath), fileName)
    : fileName === basename(source.index.filePath)
      ? source.index.filePath
      : undefined;
  if (!sourcePath) {
    return renderSkillVisibility(target, source.desiredVisibility, [])
      .find((file) => file.fileName === fileName)?.content;
  }
  try {
    const content = readFileSync(sourcePath);
    return renderSkillVisibility(target, source.desiredVisibility, [{ fileName, content }])[0]?.content;
  } catch {
    return undefined;
  }
}

function projectionFileNames(
  source: SkillSourceEntry,
  target: "claude" | "codex" | "opencode",
): readonly string[] {
  if (source.origin === "builtin") {
    return source.desiredVisibility === "explicit-only" && target === "codex"
      ? ["SKILL.md", "agents/openai.yaml"]
      : ["SKILL.md"];
  }
  if (!source.index.filePath) {
    return ["SKILL.md"];
  }
  if (canonicalSkillKey(basename(dirname(source.index.filePath))) !== canonicalSkillKey(source.index.name)) {
    const flatNames = [basename(source.index.filePath)];
    return source.desiredVisibility === "explicit-only" && target === "codex"
      ? [...flatNames, "agents/openai.yaml"]
      : flatNames;
  }
  try {
    const sourceDir = dirname(source.index.filePath);
    const names = readSkillProjectionFileNames(sourceDir, sourceDir)
      .filter((name) => target === "codex" || name.toLowerCase() !== "agents/openai.yaml");
    return source.desiredVisibility === "explicit-only" && target === "codex"
      && !names.some((name) => name.toLowerCase() === "agents/openai.yaml")
      ? [...names, "agents/openai.yaml"]
      : names;
  } catch {
    return [basename(source.index.filePath)];
  }
}

function readSkillProjectionFileNames(sourceRoot: string, currentDir: string): readonly string[] {
  return readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (!isSafeProjectionPathComponent(entry.name)) return [];
      const sourcePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return readSkillProjectionFileNames(sourceRoot, sourcePath);
      }
      return entry.isFile()
        ? [relative(sourceRoot, sourcePath).split(sep).join("/")]
        : [];
    });
}

function aggregateProjectionStatus(
  statuses: readonly KilnSkillCatalogProjectionStatus[],
): KilnSkillCatalogProjectionStatus {
  if (statuses.includes("drifted")) return "drifted";
  if (statuses.includes("unmanaged-native")) return "unmanaged-native";
  if (statuses.includes("missing")) return "missing";
  return "projected";
}

function readProjectionStatus(
  targetId: string,
  path: string,
  installState: NativeProjectionInstallState,
  managed: boolean,
  desiredContent?: string | Uint8Array,
  expected?: {
    readonly targetId: string;
    readonly filePath: string;
    readonly harness: "claude" | "codex" | "opencode";
    readonly sourceIdentity: string;
  },
  harnessRoot?: string,
): KilnSkillCatalogProjectionStatus {
  if (!existsSync(path)) {
    return "missing";
  }
  if (!managed) {
    return "unmanaged-native";
  }
  const currentContent = readFileSync(path);
  if (desiredContent !== undefined && expected
    && !isFullyOwnedNativeProjectionFile(installState.targets[targetId], expected)) {
    const adopted = harnessRoot
      ? adoptLegacyNativeProjectionFile({
        target: installState.targets[targetId],
        currentContent,
        expected,
        harnessRoot,
      })
      : undefined;
    if (adopted && nativeProjectionFileMatchesDesired({
      target: adopted,
      currentContent,
      desiredContent,
      expected,
    })) {
      return "projected";
    }
    return "drifted";
  }
  if (desiredContent !== undefined && nativeProjectionFileMatchesDesired({
    target: installState.targets[targetId],
    currentContent,
    desiredContent,
    expected,
  })) {
    return "projected";
  }
  const drift = detectNativeProjectionFileDrift({
    targetId,
    state: installState,
    currentContent,
  });
  return drift ? "drifted" : "projected";
}

function findSkillProjectionState(
  installState: NativeProjectionInstallState,
  targetId: string,
): NativeProjectionTargetState | undefined {
  const exact = installState.targets[targetId];
  if (exact) return exact;
  const marker = targetId.indexOf("-skill:");
  if (marker < 0) return undefined;
  const prefix = targetId.slice(0, marker + "-skill:".length);
  const suffix = targetId.slice(prefix.length);
  const separator = suffix.indexOf("/");
  if (separator <= 0) return undefined;
  const canonicalSkill = canonicalSkillKey(suffix.slice(0, separator));
  const fileName = suffix.slice(separator + 1);
  return Object.entries(installState.targets).find(([candidateId]) => {
    if (!candidateId.startsWith(prefix)) return false;
    const candidateSuffix = candidateId.slice(prefix.length);
    const candidateSeparator = candidateSuffix.indexOf("/");
    return candidateSeparator > 0
      && canonicalSkillKey(candidateSuffix.slice(0, candidateSeparator)) === canonicalSkill
      && candidateSuffix.slice(candidateSeparator + 1) === fileName;
  })?.[1];
}

function discoverUnmanagedNativeSkills(
  userHome: string,
  configuredNames: ReadonlySet<string>,
): readonly KilnSkillCatalogSnapshotEntry[] {
  const entries: KilnSkillCatalogSnapshotEntry[] = [];
  const seen = new Set<string>();
  for (const target of NATIVE_SKILL_TARGETS) {
    const targetRoot = target.dir(userHome);
    for (const name of readNativeSkillNames(targetRoot)) {
      if (!isSafeProjectionPathComponent(name)) continue;
      if (configuredNames.has(canonicalSkillKey(name))) {
        continue;
      }
      const key = `${target.target}:${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        name,
        description: "Native harness-local skill outside the Kiln registry.",
        origin: "native-harness",
        configured: false,
        builtIn: false,
        sourcePath: join(targetRoot, name, "SKILL.md"),
        desiredVisibility: "implicit",
        projections: [{
          target: target.target,
          displayName: target.displayName,
          path: join(targetRoot, name, "SKILL.md"),
          status: "unmanaged-native",
          effectiveVisibility: "implicit",
          visibilityCapability: "unsupported",
          visibilityReason: "Native harness-local visibility is outside Kiln governance.",
        }],
        admission: {
          state: "unavailable",
          reason: "Harness-local skill is not configured in Kiln, not governed, and not admitted into managed invocation context.",
        },
        omissionReason: "native-harness-local-only",
      });
    }
  }
  return entries;
}

function readNativeSkillNames(targetRoot: string): readonly string[] {
  try {
    return readdirSync(targetRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()
        && isSafeProjectionPathComponent(entry.name)
        && readDirectorySkillMarkdownPath(join(targetRoot, entry.name)))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
