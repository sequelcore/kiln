import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

export type DocumentationDiagnosticCode =
  | "ambiguous-link-text"
  | "heading-level-skip"
  | "missing-local-anchor"
  | "missing-local-target"
  | "provisional-package-install"
  | "title-count";

export interface DocumentationDiagnostic {
  readonly code: DocumentationDiagnosticCode;
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

export interface ValidateMarkdownDocumentInput {
  readonly path: string;
  readonly content: string;
  readonly localTargetExists: (repoRelativePath: string) => boolean;
  readonly localAnchorExists?: (
    repoRelativePath: string,
    anchor: string,
  ) => boolean;
}

const AMBIGUOUS_LINK_TEXT = new Set(["click here", "here", "read more"]);
const PROVISIONAL_PACKAGE_INSTALL =
  /\b(?:bun\s+add(?:\s+-g)?|npm\s+(?:install|i)(?:\s+-g)?|pnpm\s+add(?:\s+-g)?|yarn\s+(?:global\s+)?add)\s+[^\n]*@kilnai\//i;
const PROVISIONAL_PACKAGE_CDN = /cdn\.jsdelivr\.net\/npm\/@kilnai\//i;

export function validateMarkdownDocument(
  input: ValidateMarkdownDocumentInput,
): readonly DocumentationDiagnostic[] {
  const documentPath = normalizeRepoPath(input.path);
  const diagnostics: DocumentationDiagnostic[] = [];
  const lines = input.content.split(/\r?\n/);
  let fence: "`" | "~" | undefined;
  let titleCount = 0;
  let firstTitleLine = 1;
  let previousHeadingLevel = 0;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as "`" | "~";
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const markdownHeading = line.match(/^(#{1,6})\s+\S/);
    const htmlTitle = /<h1(?:\s[^>]*)?>.*<\/h1>/i.test(line);
    if (markdownHeading) {
      const level = markdownHeading[1]!.length;
      if (level === 1) {
        titleCount += 1;
        firstTitleLine = titleCount === 1 ? lineNumber : firstTitleLine;
      }
      if (level > previousHeadingLevel + 1) {
        diagnostics.push({
          code: "heading-level-skip",
          path: documentPath,
          line: lineNumber,
          message: `Heading level jumps from H${previousHeadingLevel} to H${level}.`,
        });
      }
      previousHeadingLevel = level;
    } else if (htmlTitle) {
      titleCount += 1;
      firstTitleLine = titleCount === 1 ? lineNumber : firstTitleLine;
      previousHeadingLevel = 1;
    }

    for (const match of line.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
      const isImage = match[1] === "!";
      const label = match[2]!.trim();
      const target = parseLinkTarget(match[3]!);
      if (!isImage && AMBIGUOUS_LINK_TEXT.has(label.toLowerCase())) {
        diagnostics.push({
          code: "ambiguous-link-text",
          path: documentPath,
          line: lineNumber,
          message: `Link text '${label}' does not describe its destination.`,
        });
      }
      if (target && isLocalTarget(target)) {
        validateLocalTarget(
          documentPath,
          lineNumber,
          target,
          input.localTargetExists,
          input.localAnchorExists,
          diagnostics,
        );
      }
    }

    const referenceDefinition = line.match(/^\s*\[[^\]]+\]:\s*(\S+)/);
    if (referenceDefinition) {
      const target = parseLinkTarget(referenceDefinition[1]!);
      if (target && isLocalTarget(target)) {
        validateLocalTarget(
          documentPath,
          lineNumber,
          target,
          input.localTargetExists,
          input.localAnchorExists,
          diagnostics,
        );
      }
    }

    if (
      !documentPath.startsWith("docs/releases/") &&
      (PROVISIONAL_PACKAGE_INSTALL.test(line) ||
        PROVISIONAL_PACKAGE_CDN.test(line))
    ) {
      diagnostics.push({
        code: "provisional-package-install",
        path: documentPath,
        line: lineNumber,
        message:
          "Current documentation must not install provisional @kilnai package coordinates.",
      });
    }
  }

  if (titleCount !== 1) {
    diagnostics.push({
      code: "title-count",
      path: documentPath,
      line: firstTitleLine,
      message: `Expected exactly one H1 title, found ${titleCount}.`,
    });
  }

  return diagnostics;
}

export function validateDocumentationTree(
  repoRoot: string,
): readonly DocumentationDiagnostic[] {
  const root = resolve(repoRoot);
  const documentPaths = collectPublicMarkdownPaths(root);
  const anchorCache = new Map<string, ReadonlySet<string>>();
  const diagnostics = documentPaths.flatMap((documentPath) =>
    validateMarkdownDocument({
      path: documentPath,
      content: readFileSync(resolve(root, ...documentPath.split("/")), "utf8"),
      localTargetExists: (target) =>
        existsSync(resolve(root, ...target.split("/"))),
      localAnchorExists: (target, anchor) => {
        const absoluteTarget = resolve(root, ...target.split("/"));
        if (!existsSync(absoluteTarget) || !target.endsWith(".md")) return true;
        let anchors = anchorCache.get(target);
        if (!anchors) {
          anchors = collectMarkdownAnchors(readFileSync(absoluteTarget, "utf8"));
          anchorCache.set(target, anchors);
        }
        return anchors.has(anchor);
      },
    }),
  );
  return diagnostics.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.code.localeCompare(right.code),
  );
}

function collectPublicMarkdownPaths(repoRoot: string): readonly string[] {
  const paths = ["README.md", "CONTRIBUTING.md"];
  paths.push(...walkMarkdown(repoRoot, "docs"));

  const packagesRoot = resolve(repoRoot, "packages");
  if (existsSync(packagesRoot)) {
    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const readme = `packages/${entry.name}/README.md`;
      if (existsSync(resolve(repoRoot, ...readme.split("/")))) paths.push(readme);
    }
  }

  return [...new Set(paths)].sort();
}

function walkMarkdown(repoRoot: string, relativeDirectory: string): string[] {
  const absoluteDirectory = resolve(
    repoRoot,
    ...normalizeRepoPath(relativeDirectory).split("/"),
  );
  if (!existsSync(absoluteDirectory)) return [];

  const paths: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) paths.push(...walkMarkdown(repoRoot, relativePath));
    else if (entry.isFile() && entry.name.endsWith(".md")) paths.push(relativePath);
  }
  return paths;
}

function validateLocalTarget(
  documentPath: string,
  line: number,
  target: string,
  localTargetExists: (repoRelativePath: string) => boolean,
  localAnchorExists:
    | ((repoRelativePath: string, anchor: string) => boolean)
    | undefined,
  diagnostics: DocumentationDiagnostic[],
): void {
  const [pathPart, rawFragment] = target.split("#", 2);
  const pathWithoutQuery = pathPart!.split("?", 1)[0];

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathWithoutQuery);
  } catch {
    decoded = pathWithoutQuery;
  }
  const relativeTarget = decoded
    ? decoded.startsWith("/")
      ? normalizeRepoPath(decoded.slice(1))
      : normalizeRepoPath(posix.join(posix.dirname(documentPath), decoded))
    : documentPath;
  if (!localTargetExists(relativeTarget)) {
    diagnostics.push({
      code: "missing-local-target",
      path: documentPath,
      line,
      message: `Local link target '${target}' does not exist (${relativeTarget}).`,
    });
    return;
  }

  if (!rawFragment || !localAnchorExists) return;
  let fragment: string;
  try {
    fragment = decodeURIComponent(rawFragment).toLowerCase();
  } catch {
    fragment = rawFragment.toLowerCase();
  }
  if (localAnchorExists(relativeTarget, fragment)) return;

  diagnostics.push({
    code: "missing-local-anchor",
    path: documentPath,
    line,
    message: `Local link anchor '${target}' does not exist (${relativeTarget}#${fragment}).`,
  });
}

function collectMarkdownAnchors(content: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const slugCounts = new Map<string, number>();
  let fence: "`" | "~" | undefined;

  for (const line of content.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as "`" | "~";
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    for (const match of line.matchAll(/<a\s+(?:[^>]*?\s)?(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
      anchors.add(match[1]!.toLowerCase());
    }

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const baseSlug = githubHeadingSlug(heading[1]!);
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    anchors.add(count === 0 ? baseSlug : `${baseSlug}-${count}`);
  }

  return anchors;
}

function githubHeadingSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseLinkTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    return closing > 0 ? trimmed.slice(1, closing) : trimmed;
  }
  return trimmed.split(/\s+["']/u, 1)[0] ?? "";
}

function isLocalTarget(target: string): boolean {
  return !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

function normalizeRepoPath(value: string): string {
  return posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
}

if (import.meta.main) {
  const diagnostics = validateDocumentationTree(process.cwd());
  for (const diagnostic of diagnostics) {
    console.error(
      `${diagnostic.path}:${diagnostic.line} [${diagnostic.code}] ${diagnostic.message}`,
    );
  }
  if (diagnostics.length > 0) process.exitCode = 1;
  else console.log("Documentation check passed.");
}
