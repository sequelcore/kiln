import type { Dirent, Stats } from "node:fs";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SkillIndex } from "@kilnai/core";
import { readSkillMdIndex } from "./filesystem-skill-registry.js";

export type SkillPackageHealthStatus = "healthy" | "warning" | "blocked";
export type SkillPackageRiskKind =
  | "code-execution"
  | "network-access"
  | "credential-pattern"
  | "outside-filesystem-access";

export interface SkillPackageHealthOptions {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxPackageBytes?: number;
  readonly maxDepth?: number;
}

export interface SkillPackageHealth {
  readonly status: SkillPackageHealthStatus;
  readonly fileCount: number;
  readonly packageBytes: number;
  readonly version?: string;
  readonly compatibility?: string;
  readonly license?: string;
  readonly brokenResources: readonly {
    readonly source: string;
    readonly target: string;
    readonly reason: "missing" | "outside-package";
  }[];
  readonly riskSignals: readonly { readonly kind: SkillPackageRiskKind; readonly path: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly path?: string }[];
}

export function inspectSkillPackage(root: string, options: SkillPackageHealthOptions = {}): SkillPackageHealth {
  const limits = {
    maxFiles: options.maxFiles ?? 512,
    maxFileBytes: options.maxFileBytes ?? 1024 * 1024,
    maxPackageBytes: options.maxPackageBytes ?? 8 * 1024 * 1024,
    maxDepth: options.maxDepth ?? 8,
  };
  const files: { path: string; content: Buffer }[] = [];
  const diagnostics: { code: string; message: string; path?: string }[] = [];
  let packageBytes = 0;
  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(root);
  } catch {
    return blocked("package-unavailable", "Skill package root is unavailable.");
  }

  const walk = (current: string, depth: number): void => {
    if (diagnostics.some((entry) => entry.code.startsWith("oversized-") || entry.code === "too-many-files")) return;
    if (depth > limits.maxDepth) {
      diagnostics.push({
        code: "package-too-deep",
        message: `Skill package exceeds depth ${limits.maxDepth}.`,
        path: portable(current),
      });
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      diagnostics.push({
        code: "resource-unreadable",
        message: "Skill package directory is unreadable.",
        path: portable(relative(physicalRoot, current)),
      });
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current, entry.name);
      const rel = portable(relative(physicalRoot, path));
      let stat: Stats;
      try {
        stat = lstatSync(path);
      } catch {
        diagnostics.push({ code: "resource-unreadable", message: "Skill package entry is unreadable.", path: rel });
        continue;
      }
      if (stat.isSymbolicLink()) {
        diagnostics.push({
          code: "package-symlink",
          message: "Symbolic links are not admitted inside skill packages.",
          path: rel,
        });
      } else if (stat.isDirectory()) {
        walk(path, depth + 1);
      } else if (stat.isFile()) {
        if (files.length + 1 > limits.maxFiles) {
          diagnostics.push({ code: "too-many-files", message: `Skill package exceeds ${limits.maxFiles} files.` });
          return;
        }
        if (stat.size > limits.maxFileBytes) {
          diagnostics.push({
            code: "oversized-file",
            message: `Skill package file exceeds ${limits.maxFileBytes} bytes.`,
            path: rel,
          });
          continue;
        }
        if (packageBytes + stat.size > limits.maxPackageBytes) {
          diagnostics.push({
            code: "oversized-package",
            message: `Skill package exceeds ${limits.maxPackageBytes} bytes.`,
          });
          return;
        }
        try {
          const content = readFileSync(path);
          packageBytes += content.byteLength;
          files.push({ path: rel, content });
        } catch {
          diagnostics.push({ code: "resource-unreadable", message: "Skill package file is unreadable.", path: rel });
        }
      }
    }
  };
  walk(physicalRoot, 0);

  const skillPath = join(physicalRoot, "SKILL.md");
  let index: SkillIndex | undefined;
  try {
    index = readSkillMdIndex(skillPath);
  } catch (error) {
    diagnostics.push({
      code: "invalid-skill",
      message: error instanceof Error ? error.message : "Invalid SKILL.md.",
      path: "SKILL.md",
    });
  }
  if (
    index &&
    (index.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(index.name) || index.description.length > 1024)
  ) {
    diagnostics.push({
      code: "portable-spec-invalid",
      message: "Skill name or description violates the portable Agent Skills identity constraints.",
      path: "SKILL.md",
    });
  }
  const brokenResources: { source: string; target: string; reason: "missing" | "outside-package" }[] = [];
  for (const file of files)
    for (const target of markdownReferences(file)) {
      const clean = target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
      if (!clean || clean.startsWith("#")) continue;
      const decoded = safeDecode(clean);
      const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(decoded) || /^\\\\/.test(decoded);
      if (windowsAbsolute) {
        brokenResources.push({ source: file.path, target, reason: "outside-package" });
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) continue;
      const resolved = resolve(physicalRoot, dirname(file.path), decoded);
      const relativeTarget = portable(relative(physicalRoot, resolved));
      if (isAbsolute(decoded) || relativeTarget === ".." || relativeTarget.startsWith("../")) {
        brokenResources.push({ source: file.path, target, reason: "outside-package" });
        continue;
      }
      try {
        lstatSync(resolved);
      } catch {
        brokenResources.push({ source: file.path, target, reason: "missing" });
      }
    }
  const riskSignals = collectRiskSignals(files);
  const blockedHealth = diagnostics.length > 0 || brokenResources.length > 0;
  return {
    status: blockedHealth ? "blocked" : riskSignals.length > 0 ? "warning" : "healthy",
    fileCount: files.length,
    packageBytes,
    ...(index?.metadata?.version ? { version: index.metadata.version } : {}),
    ...(index?.compatibility ? { compatibility: index.compatibility } : {}),
    ...(index?.license ? { license: index.license } : {}),
    brokenResources,
    riskSignals,
    diagnostics,
  };

  function blocked(code: string, message: string): SkillPackageHealth {
    return {
      status: "blocked",
      fileCount: 0,
      packageBytes: 0,
      brokenResources: [],
      riskSignals: [],
      diagnostics: [{ code, message }],
    };
  }
}

function markdownReferences(file: { path: string; content: Buffer }): readonly string[] {
  if (!/\.md$/i.test(file.path)) return [];
  const text = file.content.toString("utf8");
  return [...text.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)]
    .map((match) => match[1]!)
    .filter(Boolean);
}

function collectRiskSignals(files: readonly { path: string; content: Buffer }[]) {
  const results: { kind: SkillPackageRiskKind; path: string }[] = [];
  const add = (kind: SkillPackageRiskKind, path: string): void => {
    if (!results.some((entry) => entry.kind === kind && entry.path === path)) results.push({ kind, path });
  };
  for (const file of files) {
    const text = file.content.toString("utf8");
    if (/\.(?:sh|bash|zsh|ps1|py|js|mjs|cjs|ts|exe|bat|cmd)$/i.test(file.path)) add("code-execution", file.path);
    if (/\b(?:curl|wget|fetch\s*\(|requests\.|https?:\/\/)/i.test(text)) add("network-access", file.path);
    if (/\b(?:authorization|api[_-]?key|access[_-]?token|bearer\s+)[\s:=]/i.test(text))
      add("credential-pattern", file.path);
    if (/(?:^|[\s'"`(])\.\.\//m.test(text) || /(?:^|[\s'"`(])[A-Za-z]:[\\/]/m.test(text))
      add("outside-filesystem-access", file.path);
  }
  return results;
}

function portable(path: string): string {
  return path.replaceAll("\\", "/");
}
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
