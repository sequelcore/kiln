import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "yaml";
import { canonicalSkillIdentity, digestSkillPackage } from "@kilnai/core";
import { inspectSkillPackage, readSkillMdIndex } from "@kilnai/runtime";
import type {
  KilnSkillInventoryDiagnosticSnapshot,
  KilnSkillSourceCandidateSnapshot,
  KilnSkillSourceInventorySnapshot,
  KilnSkillSourceKind,
  KilnSkillSourceRelationship,
} from "@kilnai/gateway-contracts";

export interface SkillInventoryRoot {
  readonly id?: string;
  readonly sourceKind: KilnSkillSourceKind;
  readonly root: string;
  readonly relationship: KilnSkillSourceRelationship;
  readonly managedCanonicalNames?: ReadonlySet<string>;
  readonly managedSkillPaths?: ReadonlySet<string>;
  readonly required?: boolean;
  readonly applicableHarnesses?: readonly ("claude" | "codex" | "opencode")[];
  readonly excludedTopLevelNames?: ReadonlySet<string>;
  readonly harness?: "claude" | "codex" | "opencode";
  readonly exposureScope?: "user" | "project" | "harness" | "builtin";
}

export interface SkillPluginInventoryResult {
  readonly roots: readonly SkillInventoryRoot[];
  readonly diagnostics: readonly KilnSkillInventoryDiagnosticSnapshot[];
}

export type SkillPluginProvider = () => SkillPluginInventoryResult;
export type SkillInventoryCommandRunner = (
  command: string, args: readonly string[], timeoutMs: number,
) => { readonly status: number | null; readonly stdout: string; readonly stderr: string };

export interface CollectSkillSourceInventoryOptions {
  readonly roots: readonly SkillInventoryRoot[];
  readonly pluginProvider?: SkillPluginProvider;
  readonly commandRunner?: SkillInventoryCommandRunner;
  readonly limits?: {
    readonly maxDepth?: number; readonly maxEntries?: number; readonly maxFiles?: number;
    readonly maxTotalBytes?: number; readonly maxFileBytes?: number;
  };
  readonly virtualCandidates?: readonly KilnSkillSourceCandidateSnapshot[];
  readonly trustedRealRoots?: readonly string[];
  /** Internal evidence hook. Absolute paths are never added to the public snapshot. */
  readonly onCandidateResolved?: (sourceId: string, absoluteSkillFilePath: string) => void;
}

export function collectSkillSourceInventory(
  options: CollectSkillSourceInventoryOptions,
): KilnSkillSourceInventorySnapshot {
  const diagnostics: KilnSkillInventoryDiagnosticSnapshot[] = [];
  const plugin = options.pluginProvider
    ? options.pluginProvider()
    : defaultCodexPluginProvider(options.commandRunner ?? runCommand);
  diagnostics.push(...plugin.diagnostics);
  const candidates = [...(options.virtualCandidates ?? [])];
  const budget: TraversalBudget = {
    entries: 0, files: 0, bytes: 0, exhausted: false,
    maxDepth: options.limits?.maxDepth ?? 8,
    maxEntries: options.limits?.maxEntries ?? 10_000,
    maxFiles: options.limits?.maxFiles ?? 5_000,
    maxTotalBytes: options.limits?.maxTotalBytes ?? 64 * 1024 * 1024,
    maxFileBytes: options.limits?.maxFileBytes ?? 4 * 1024 * 1024,
  };
  const packageCache = new Map<string, ReturnType<typeof collectPackage>>();
  const trustedRealRoots = resolveTrustedRealRoots(options.trustedRealRoots ?? []);
  for (const root of [...options.roots, ...plugin.roots]) {
    if (budget.exhausted) break;
    candidates.push(...collectRoot(root, budget, diagnostics, trustedRealRoots, packageCache, options.onCandidateResolved));
  }
  const canonicalNames = new Set(candidates
    .filter((entry) => entry.relationship === "canonical")
    .map((entry) => entry.canonicalName));
  const related = candidates.map((entry) => {
    if (entry.relationship === "managed-projection") {
      return { ...entry, relatedCanonicalName: canonicalNames.has(entry.canonicalName) ? entry.canonicalName : undefined };
    }
    if (entry.relationship === "linked-alias") {
      const source = candidates.find((candidate) => candidate.relationship !== "linked-alias"
        && candidate.canonicalName === entry.canonicalName && candidate.packageDigest === entry.packageDigest);
      return { ...entry, ...(source ? { relatedSourceId: source.sourceId } : {}) };
    }
    return entry;
  });
  const independent = related.filter((entry) => entry.relationship !== "managed-projection" && entry.relationship !== "linked-alias");
  const sourceGroups = new Map<KilnSkillSourceKind, KilnSkillSourceCandidateSnapshot[]>();
  for (const entry of related) {
    const group = sourceGroups.get(entry.sourceKind) ?? [];
    group.push(entry);
    sourceGroups.set(entry.sourceKind, group);
  }
  const grouped = new Map<string, KilnSkillSourceCandidateSnapshot[]>();
  for (const entry of independent) {
    const group = grouped.get(entry.canonicalName) ?? [];
    group.push(entry);
    grouped.set(entry.canonicalName, group);
  }
  const identities = [...grouped.entries()].map(([canonicalName, group]) => {
    const names = [...new Set(group.map((entry) => entry.name))].sort();
    const digests = new Set(group.map((entry) => entry.packageDigest));
    return {
      canonicalName,
      names,
      candidateSourceIds: group.map((entry) => entry.sourceId).sort(),
      classification: names.length > 1
        ? "case-collision" as const
        : group.length === 1
          ? "unique" as const
          : digests.size === 1
            ? "equivalent-duplicate" as const
            : "divergent-collision" as const,
    };
  }).sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
  const resolutions = [...grouped.entries()].filter(([, group]) => group.length > 1).map(([canonicalName, group]) =>
    resolveIdentity(canonicalName, group));
  return {
    complete: diagnostics.length === 0,
    candidates: related.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    sources: [...sourceGroups.entries()].map(([sourceKind, group]) => ({
      sourceKind,
      candidateCount: group.length,
      descriptionBytes: group.reduce((total, entry) => total + entry.descriptionBytes, 0),
    })).sort((left, right) => left.sourceKind.localeCompare(right.sourceKind)),
    identities,
    resolutions,
    harnesses: (["claude", "codex", "opencode"] as const).map((harness) => {
      const applicable = related.filter((entry) => entry.relationship !== "managed-projection"
        && entry.applicableHarnesses.includes(harness));
      return {
        harness, candidateCount: applicable.length,
        descriptionBytes: applicable.reduce((total, entry) => total + entry.descriptionBytes, 0),
        budget: harness === "codex"
          ? { status: "known" as const, authority: "OpenAI Codex Build skills documentation, accessed 2026-08-12", contextRatio: 0.02, fallbackCharacters: 8_000, reason: "Codex limits the initial skill list to 2% of model context, or 8,000 characters when context is unknown." }
          : { status: "unknown" as const, reason: "No authoritative harness metadata budget was supplied." },
      };
    }),
    diagnostics,
  };
}

function resolveTrustedRealRoots(roots: readonly string[]): readonly string[] {
  return roots.flatMap((root) => {
    try { return [normalizeSkillInventoryPath(realpathSync(root))]; } catch { return []; }
  });
}

function resolveTrustedLinkedDirectory(path: string, trustedRealRoots: readonly string[]): string | undefined {
  try {
    const physical = realpathSync(path);
    if (!statSync(physical).isDirectory()) return undefined;
    const normalized = normalizeSkillInventoryPath(physical);
    const trusted = trustedRealRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
    return trusted ? physical : undefined;
  } catch {
    return undefined;
  }
}

interface TraversalBudget {
  entries: number; files: number; bytes: number; exhausted: boolean;
  maxDepth: number; maxEntries: number; maxFiles: number; maxTotalBytes: number; maxFileBytes: number;
}

function resolveIdentity(canonicalName: string, group: readonly KilnSkillSourceCandidateSnapshot[]) {
  const rank = (candidate: KilnSkillSourceCandidateSnapshot): number =>
    candidate.sourceKind === "kiln-project" ? 0 : candidate.sourceKind === "kiln-user" ? 1 : candidate.sourceKind === "builtin" ? 2 : 99;
  const canonical = group.filter((candidate) => candidate.relationship === "canonical");
  const bestRank = Math.min(...canonical.map(rank));
  const best = canonical.filter((candidate) => rank(candidate) === bestRank);
  const selected = best.length === 1 ? best[0] : undefined;
  const externalOnlyDivergent = canonical.length === 0 && new Set(group.map((entry) => entry.packageDigest)).size > 1;
  return {
    canonicalName,
    status: selected && !externalOnlyDivergent ? "selected" as const : "unresolved" as const,
    ...(selected ? { selectedSourceId: selected.sourceId } : {}),
    candidates: group.map((candidate) => ({
      sourceId: candidate.sourceId,
      disposition: selected?.sourceId === candidate.sourceId
        ? "selected" as const
        : candidate.relationship === "external"
          ? (selected ? "diagnostic-only" as const : "unresolved" as const)
          : selected ? "shadowed" as const : "unresolved" as const,
      reason: selected?.sourceId === candidate.sourceId
        ? "Selected by canonical precedence project > user > builtin."
        : candidate.relationship === "external"
          ? "External source is diagnostic-only and cannot override canonical resolution."
          : selected ? "Shadowed by higher canonical precedence." : "Equal-precedence candidates could not be resolved uniquely.",
    })),
  };
}

function collectRoot(
  root: SkillInventoryRoot,
  budget: TraversalBudget,
  diagnostics: KilnSkillInventoryDiagnosticSnapshot[],
  trustedRealRoots: readonly string[],
  packageCache: Map<string, ReturnType<typeof collectPackage>>,
  onCandidateResolved?: (sourceId: string, absoluteSkillFilePath: string) => void,
): KilnSkillSourceCandidateSnapshot[] {
  const candidates: KilnSkillSourceCandidateSnapshot[] = [];
  try { readdirSync(root.root); } catch {
    if (root.required) diagnostics.push({
      code: "inventory-root-unavailable",
      message: "A structured inventory source could not be read.",
      sourceId: root.sourceKind,
    });
    return candidates;
  }
  const packages = discoverPackages(root.root, root.root, 0, budget, diagnostics, root, trustedRealRoots);
  for (const candidate of packages) {
    if (budget.exhausted) break;
    const physicalKey = normalizeSkillInventoryPath(candidate.physicalPath);
    const cached = packageCache.get(physicalKey);
    const result = cached ?? collectPackage(candidate.physicalPath, budget, diagnostics, root.sourceKind);
    if (!cached && result.skillFile) packageCache.set(physicalKey, result);
    if (!result.skillFile) {
      if (candidate.linked) diagnostics.push({
        code: "inventory-link-invalid-package",
        message: "Trusted native skill link did not resolve to a readable skill package boundary.",
        sourceId: root.sourceKind,
      });
      continue;
    }
    try {
      const index = readSkillMdIndex(result.skillFile.path);
      const canonicalName = canonicalSkillIdentity(index.name);
      const normalizedSkillPath = normalizeSkillInventoryPath(result.skillFile.path);
      const relationship = candidate.linked
        ? "linked-alias" as const
        : root.managedSkillPaths?.has(normalizedSkillPath)
        ? "managed-projection" as const
        : root.relationship;
      const sourceId = `${root.id ?? root.sourceKind}:${canonicalName}:${relative(root.root, candidate.logicalPath).replaceAll("\\", "/") || "."}`;
      const health = projectHealth(inspectSkillPackage(candidate.physicalPath));
      candidates.push({
        name: index.name,
        canonicalName,
        sourceKind: root.sourceKind,
        sourceId,
        exposureScope: root.exposureScope ?? defaultExposureScope(root),
        sourcePath: `${relative(root.root, candidate.logicalPath).replaceAll("\\", "/")}/SKILL.md`,
        relationship,
        packageDigest: digestSkillPackage(result.files),
        descriptionBytes: Buffer.byteLength(index.description, "utf8"),
        ...(index.metadata?.version ? { version: index.metadata.version } : {}),
        ...(index.compatibility ? { compatibility: index.compatibility } : {}),
        ...(index.license ? { license: index.license } : {}),
        trust: candidateTrust(root.sourceKind, relationship),
        freshness: candidateFreshness(relationship),
        dependencies: {
          allowedTools: index.tools,
          executableResources: health.riskSignals.filter((entry) => entry.kind === "code-execution").length,
        },
        health,
        applicableHarnesses: root.applicableHarnesses ?? applicableHarnesses(root.sourceKind),
        effectiveVisibility: readCandidateVisibility(root, candidate.physicalPath, result.skillFile.path),
      });
      onCandidateResolved?.(sourceId, result.skillFile.path);
    } catch {
      diagnostics.push({ code: "inventory-invalid-skill", message: "Invalid SKILL.md excluded from inventory.", sourceId: root.sourceKind });
    }
  }
  return candidates;
}

function projectHealth(health: ReturnType<typeof inspectSkillPackage>): KilnSkillSourceCandidateSnapshot["health"] {
  return {
    status: health.status, fileCount: health.fileCount, packageBytes: health.packageBytes,
    brokenResourceCount: health.brokenResources.length,
    riskSignals: health.riskSignals,
    diagnostics: health.diagnostics,
  };
}

function candidateTrust(
  sourceKind: KilnSkillSourceKind,
  relationship: KilnSkillSourceRelationship,
): KilnSkillSourceCandidateSnapshot["trust"] {
  if (sourceKind === "builtin") return { level: "builtin", reason: "Versioned with the running Kiln build." };
  if (relationship === "canonical") return { level: "local-configured", reason: "Loaded from a configured local Kiln source." };
  return { level: "external-unverified", reason: "Discovered outside canonical Kiln ownership; package contents require review before admission." };
}

function candidateFreshness(
  relationship: KilnSkillSourceRelationship,
): KilnSkillSourceCandidateSnapshot["freshness"] {
  return relationship === "canonical"
    ? { status: "current", reason: "Read directly from the canonical package during this inventory." }
    : { status: "unknown", reason: "No authoritative upstream version comparison is available for this discovered copy." };
}

function defaultExposureScope(root: SkillInventoryRoot): "user" | "project" | "harness" | "builtin" {
  if (root.sourceKind === "builtin") return "builtin";
  if (root.sourceKind === "kiln-project" || root.id?.includes(":project")) return "project";
  if (root.sourceKind === "native-harness" || root.sourceKind === "system") return "harness";
  return "user";
}

function discoverPackages(
  root: string, current: string, depth: number, budget: TraversalBudget,
  diagnostics: KilnSkillInventoryDiagnosticSnapshot[], inventoryRoot: SkillInventoryRoot,
  trustedRealRoots: readonly string[],
): { logicalPath: string; physicalPath: string; linked: boolean }[] {
  if (budget.exhausted) return [];
  if (depth > budget.maxDepth) { exhaust(budget, diagnostics, "inventory-depth-limit", `Inventory depth limit ${budget.maxDepth} reached.`, inventoryRoot.sourceKind); return []; }
  let entries: Dirent[];
  try { entries = readdirSync(current, { withFileTypes: true }); } catch { diagnostics.push({ code: "inventory-read-failed", message: "Inventory directory could not be read.", sourceId: inventoryRoot.sourceKind }); return []; }
  const packages = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md") ? [{ logicalPath: current, physicalPath: current, linked: false }] : [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (++budget.entries > budget.maxEntries) { exhaust(budget, diagnostics, "inventory-entry-limit", `Inventory entry limit ${budget.maxEntries} reached.`, inventoryRoot.sourceKind); break; }
    const path = join(current, entry.name);
    if (current === root && inventoryRoot.excludedTopLevelNames?.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      if (current !== root || inventoryRoot.sourceKind !== "native-harness") {
        diagnostics.push({ code: "inventory-symlink-skipped", message: "Symbolic link skipped during bounded skill inventory.", sourceId: inventoryRoot.sourceKind }); continue;
      }
      const resolved = resolveTrustedLinkedDirectory(path, trustedRealRoots);
      if (!resolved) {
        diagnostics.push({ code: "inventory-link-untrusted", message: "Native skill link was broken, unreadable, or outside trusted inventory roots.", sourceId: inventoryRoot.sourceKind }); continue;
      }
      packages.push({ logicalPath: path, physicalPath: resolved, linked: true });
      continue;
    }
    if (entry.isDirectory()) packages.push(...discoverPackages(root, path, depth + 1, budget, diagnostics, inventoryRoot, trustedRealRoots));
  }
  return packages;
}

function collectPackage(root: string, budget: TraversalBudget, diagnostics: KilnSkillInventoryDiagnosticSnapshot[], sourceId: string): {
  files: { path: string; content: Uint8Array }[];
  skillFile?: { path: string };
} {
  const files: { path: string; content: Uint8Array }[] = [];
  let skillFile: { path: string } | undefined;
  const walk = (current: string, depth: number): void => {
    if (budget.exhausted) return;
    if (depth > budget.maxDepth) { exhaust(budget, diagnostics, "inventory-depth-limit", `Inventory depth limit ${budget.maxDepth} reached.`, sourceId); return; }
    let entries: Dirent[];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { diagnostics.push({ code: "inventory-read-failed", message: "Skill package could not be read completely." }); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++budget.entries > budget.maxEntries) { exhaust(budget, diagnostics, "inventory-entry-limit", `Inventory entry limit ${budget.maxEntries} reached.`, sourceId); return; }
      const path = join(current, entry.name);
      let stat: ReturnType<typeof lstatSync>;
      try { stat = lstatSync(path); } catch { diagnostics.push({ code: "inventory-read-failed", message: "Skill package entry could not be inspected." }); continue; }
      if (stat.isSymbolicLink()) { diagnostics.push({ code: "inventory-symlink-skipped", message: "Symbolic link skipped during package digest." }); continue; }
      if (stat.isDirectory()) {
        try {
          if (readdirSync(path, { withFileTypes: true }).some((child) => child.isFile() && child.name.toLowerCase() === "skill.md")) continue;
        } catch { diagnostics.push({ code: "inventory-read-failed", message: "Skill package directory could not be read." }); continue; }
        walk(path, depth + 1);
      }
      else if (stat.isFile()) {
        try {
          if (++budget.files > budget.maxFiles) { exhaust(budget, diagnostics, "inventory-file-limit", `Inventory file limit ${budget.maxFiles} reached.`, sourceId); return; }
          if (stat.size > budget.maxFileBytes) { exhaust(budget, diagnostics, "inventory-file-bytes-limit", `Inventory per-file byte limit ${budget.maxFileBytes} exceeded.`, sourceId); return; }
          if (budget.bytes + stat.size > budget.maxTotalBytes) { exhaust(budget, diagnostics, "inventory-total-bytes-limit", `Inventory total byte limit ${budget.maxTotalBytes} exceeded.`, sourceId); return; }
          const content = readFileSync(path);
          budget.bytes += content.byteLength;
          files.push({ path: relative(root, path).replaceAll("\\", "/"), content });
          if (entry.name.toLowerCase() === "skill.md" && dirname(path) === root) skillFile = { path };
        } catch { diagnostics.push({ code: "inventory-read-failed", message: "Skill package file could not be read." }); }
      }
    }
  };
  walk(root, 0);
  return { files, ...(skillFile ? { skillFile } : {}) };
}

function exhaust(
  budget: TraversalBudget, diagnostics: KilnSkillInventoryDiagnosticSnapshot[],
  code: string, message: string, sourceId: string,
): void {
  if (budget.exhausted) return;
  budget.exhausted = true;
  diagnostics.push({ code, message, sourceId });
}

function applicableHarnesses(sourceKind: KilnSkillSourceKind): readonly ("claude" | "codex" | "opencode")[] {
  if (sourceKind === "shared-agents") return ["codex", "opencode"];
  return sourceKind === "system" || sourceKind === "plugin"
    ? ["codex"]
    : ["claude", "codex", "opencode"];
}

export function normalizeSkillInventoryPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = path.replaceAll("\\", "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function readCandidateVisibility(root: SkillInventoryRoot, packageRoot: string, skillFile: string): "implicit" | "explicit-only" {
  try {
    if (root.harness === "codex" || root.sourceKind === "plugin" || root.sourceKind === "system" || root.sourceKind === "shared-agents") {
      const path = join(packageRoot, "agents", "openai.yaml");
      try {
        const metadata = parse(readFileSync(path, "utf8")) as { policy?: { allow_implicit_invocation?: unknown } } | null;
        if (metadata?.policy?.allow_implicit_invocation === false) return "explicit-only";
      } catch { /* absent metadata means implicit */ }
    }
    if (root.harness === "claude" || root.harness === "opencode") {
      const content = readFileSync(skillFile, "utf8");
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      const metadata = match ? parse(match[1] ?? "") as Record<string, unknown> : {};
      if (root.harness === "claude" && metadata["disable-model-invocation"] === true) return "explicit-only";
      const native = metadata.metadata;
      if (root.harness === "opencode" && native && typeof native === "object"
        && (native as Record<string, unknown>)["opencode/autoinvoke"] === false) return "explicit-only";
    }
  } catch { /* malformed optional visibility metadata does not prove exclusion */ }
  return "implicit";
}

export function defaultCodexPluginProvider(
  runner: SkillInventoryCommandRunner = runCommand,
  filesystem: Pick<typeof import("node:fs"), "lstatSync" | "readdirSync"> = { lstatSync, readdirSync },
): SkillPluginInventoryResult {
  let result: ReturnType<SkillInventoryCommandRunner>;
  try {
    result = runner("codex", ["plugin", "list", "--json"], 2_000);
  } catch {
    return { roots: [], diagnostics: [{ code: "plugin-inventory-unavailable", message: "Codex plugin inventory command was unavailable or failed." }] };
  }
  if (result.status !== 0) return { roots: [], diagnostics: [{ code: "plugin-inventory-unavailable", message: "Codex plugin inventory command was unavailable or failed." }] };
  try {
    const parsed = JSON.parse(result.stdout) as { installed?: unknown[] };
    if (!Array.isArray(parsed.installed)) throw new Error("missing installed list");
    const roots: SkillInventoryRoot[] = [];
    const diagnostics: KilnSkillInventoryDiagnosticSnapshot[] = [];
    for (const item of parsed.installed) {
      if (!item || typeof item !== "object") continue;
      const plugin = item as { enabled?: unknown; pluginId?: unknown; source?: { source?: unknown; path?: unknown } };
      if (plugin.enabled !== true) continue;
      if (plugin.source?.source !== "local" || typeof plugin.source.path !== "string") {
        diagnostics.push({
          code: "plugin-inventory-source-unsupported",
          message: "An enabled Codex plugin did not expose a supported structured local source.",
          ...(typeof plugin.pluginId === "string" ? { sourceId: `plugin:${plugin.pluginId}` } : {}),
        });
        continue;
      }
      try {
        filesystem.readdirSync(plugin.source.path);
      } catch {
        diagnostics.push({
          code: "plugin-inventory-root-unavailable",
          message: "An enabled Codex plugin local source could not be read.",
          ...(typeof plugin.pluginId === "string" ? { sourceId: `plugin:${plugin.pluginId}` } : {}),
        });
        continue;
      }
      const skillsRoot = join(plugin.source.path, "skills");
      try {
        const skillsStat = filesystem.lstatSync(skillsRoot);
        if (!skillsStat.isDirectory()) {
          diagnostics.push({
            code: "plugin-inventory-skills-invalid",
            message: "An enabled Codex plugin skills source was not a directory.",
            ...(typeof plugin.pluginId === "string" ? { sourceId: `plugin:${plugin.pluginId}` } : {}),
          });
          continue;
        }
        filesystem.readdirSync(skillsRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push({
          code: "plugin-inventory-skills-unavailable",
          message: "An enabled Codex plugin skills directory could not be inspected.",
          ...(typeof plugin.pluginId === "string" ? { sourceId: `plugin:${plugin.pluginId}` } : {}),
        });
        continue;
      }
      roots.push({
        id: typeof plugin.pluginId === "string" ? `plugin:${plugin.pluginId}` : "plugin:unknown",
        sourceKind: "plugin", root: skillsRoot, relationship: "external",
      });
    }
    return { roots, diagnostics };
  } catch {
    return { roots: [], diagnostics: [{ code: "plugin-inventory-invalid", message: "Codex plugin inventory returned invalid structured output." }] };
  }
}

function runCommand(command: string, args: readonly string[], timeoutMs: number) {
  const result = spawnSync(command, [...args], { encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: false });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
