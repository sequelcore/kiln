import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { API, DiagnosticCategory, type NodeHandle } from "typescript/unstable/async";
import {
  getTokenAtPosition,
  isIdentifier,
  isFunctionDeclaration,
  isParameterDeclaration,
  isImportSpecifier,
  isExportSpecifier,
  isVariableDeclaration,
  isClassDeclaration,
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  isMethodDeclaration,
  isPropertyDeclaration,
  isTypeParameterDeclaration,
} from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import type {
  CodeIntelligenceAdapter,
  CodeIntelligenceEntry,
  CodeIntelligenceRequest,
  CodeIntelligenceResult,
} from "../../packages/core/src/tools/domain/code-intelligence.js";
import { digest, isCurrent, type SourceSnapshot } from "./snapshot.js";
import { ProjectCapture } from "./project-capture.js";

const require = createRequire(import.meta.url);
const compilerRoot = dirname(require.resolve("typescript/package.json"));
const compilerMetadata: unknown = JSON.parse(readFileSync(join(compilerRoot, "package.json"), "utf8"));
const compilerVersion =
  typeof compilerMetadata === "object" &&
  compilerMetadata !== null &&
  "version" in compilerMetadata &&
  typeof compilerMetadata.version === "string"
    ? compilerMetadata.version
    : "unknown";
const ADMITTED_VERSION = "7.0.2";
const nativeRoot = dirname(
  createRequire(join(compilerRoot, "package.json")).resolve(
    `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
  ),
);

export interface ReferenceEvidence extends CodeIntelligenceResult {
  readonly disposition: "complete" | "partial" | "unsupported" | "failed";
  readonly reasons: readonly string[];
  readonly entries: readonly (CodeIntelligenceEntry & { readonly sourceHash: string })[];
  readonly scope: "selected-files-only" | "configured-project-only";
  readonly project?: {
    readonly configPath: string;
    readonly rootFiles: readonly string[];
    readonly compilerOptionsDigest: string;
    readonly inputDigest: string;
    readonly inputs: readonly { readonly path: string; readonly hash: string }[];
    readonly options: Readonly<Record<string, unknown>>;
  };
  readonly workspaceId: string;
  readonly revision: string;
  readonly sourceDigest: string;
  readonly dirtyStateDigest: string;
  readonly compilerVersion: string;
  readonly compilerInputDigest: string;
  readonly capabilities: readonly ["references"];
  readonly omittedCount: number;
  readonly diagnosticCodes: readonly number[];
  readonly elapsedMs: number;
  readonly cacheState: "cold" | "warm";
}

/** Research-only adapter. No production registration or ambient workspace reads. */
export class TypeScriptReferenceAdapter implements CodeIntelligenceAdapter {
  readonly name = "typescript-reference-experiment-v1";
  private readonly api: API;
  private readonly virtualRoot: string;
  private readonly configPath: string;
  private readonly compilerInputDigest: string;
  private readonly compilerLibraryDigest: string;
  private queried = false;
  private closed = false;
  private busy = false;
  private readonly projectCapture: ProjectCapture | undefined;
  private rootFiles: readonly string[] = [];
  private compilerOptionsDigest = "unobserved";
  private observedOptions: Readonly<Record<string, unknown>> = {};

  constructor(private readonly snapshot: SourceSnapshot) {
    if (compilerVersion !== ADMITTED_VERSION) throw new Error("unsupported-compiler-version");
    this.projectCapture = snapshot instanceof ProjectCapture ? snapshot : undefined;
    this.virtualRoot = (
      this.projectCapture ? snapshot.root : resolve(snapshot.root, "__repository_analysis_virtual__")
    ).replaceAll("\\", "/");
    this.configPath = this.projectCapture?.configPath ?? `${this.virtualRoot}/tsconfig.json`;
    const files: Record<string, string> = Object.fromEntries(
      snapshot.sources.map((source) => [`${this.virtualRoot}/${source.path}`, source.text]),
    );
    const config = JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        types: [],
        skipLibCheck: true,
        lib: ["es2022"],
      },
      files: snapshot.sources.map((source) => source.path),
    });
    files[this.configPath] = config;
    // All library content comes from the same installed compiler, never the target repository.
    const libraries = new Map<string, string>();
    let libraryBytes = 0;
    for (const name of readdirSync(join(nativeRoot, "lib"))
      .filter((name) => /^lib\..*\.d\.ts$/.test(name))
      .sort()) {
      const content = readFileSync(join(nativeRoot, "lib", name), "utf8");
      libraryBytes += Buffer.byteLength(content);
      if (libraryBytes > 16_777_216) throw new Error("compiler-library-budget");
      libraries.set(name, content);
    }
    this.compilerInputDigest = digest(
      JSON.stringify({ config, libraries: [...libraries].map(([name, text]) => [name, digest(text)]) }),
    );
    this.compilerLibraryDigest = digest(JSON.stringify([...libraries].map(([name, text]) => [name, digest(text)])));
    const virtual = createVirtualFileSystem(files);
    const normalize = (path: string): string => path.replaceAll("\\", "/");
    const libraryRoot = normalize(resolve(nativeRoot, "lib"));
    const libraryName = (path: string): string | undefined => {
      const directory = normalize(dirname(resolve(path)));
      const matches =
        process.platform === "win32"
          ? directory.toLowerCase() === libraryRoot.toLowerCase()
          : directory === libraryRoot;
      return matches && libraries.has(basename(path)) ? basename(path) : undefined;
    };
    const projectFs = this.projectCapture?.fileSystem;
    this.api = new API({
      cwd: snapshot.root,
      fs: projectFs
        ? {
            ...projectFs,
            readFile: (path) => {
              const name = libraryName(path);
              return name ? (libraries.get(name) ?? null) : (projectFs.readFile?.(path) ?? null);
            },
            fileExists: (path) => libraryName(path) !== undefined || projectFs.fileExists?.(path) === true,
            realpath: (path) => (libraryName(path) ? normalize(path) : (projectFs.realpath?.(path) ?? normalize(path))),
          }
        : {
            readFile: (path) => files[normalize(path)] ?? libraries.get(basename(path)) ?? null,
            fileExists: (path) => Object.hasOwn(files, normalize(path)) || libraries.has(basename(path)),
            directoryExists: (path) => virtual.directoryExists?.(normalize(path)) ?? false,
            getAccessibleEntries: (path) =>
              virtual.getAccessibleEntries?.(normalize(path)) ?? { files: [], directories: [] },
            realpath: normalize,
          },
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.api.close();
  }

  async query(request: CodeIntelligenceRequest): Promise<ReferenceEvidence> {
    const started = performance.now();
    const cacheState = this.queried ? "warm" : "cold";
    const result = (
      disposition: ReferenceEvidence["disposition"],
      reasons: readonly string[],
      entries: ReferenceEvidence["entries"] = [],
      omittedCount = 0,
      diagnosticCodes: readonly number[] = [],
    ): ReferenceEvidence => ({
      operation: request.operation,
      language: "typescript",
      disposition,
      reasons,
      entries,
      scope: this.projectCapture ? "configured-project-only" : "selected-files-only",
      ...(this.projectCapture
        ? {
            project: {
              configPath: relative(this.snapshot.root, this.configPath).split(sep).join("/"),
              rootFiles: this.rootFiles,
              compilerOptionsDigest: this.compilerOptionsDigest,
              inputDigest: this.projectCapture.inputDigest,
              inputs: this.projectCapture.inputs,
              options: this.observedOptions,
            },
          }
        : {}),
      workspaceId: this.snapshot.workspaceId,
      revision: this.snapshot.revision,
      sourceDigest: this.snapshot.sourceDigest,
      dirtyStateDigest: this.snapshot.dirtyStateDigest,
      compilerVersion,
      compilerInputDigest: this.projectCapture
        ? digest(
            JSON.stringify([
              compilerVersion,
              this.compilerLibraryDigest,
              this.projectCapture.inputDigest,
              this.compilerOptionsDigest,
            ]),
          )
        : this.compilerInputDigest,
      capabilities: ["references"],
      omittedCount,
      diagnosticCodes,
      elapsedMs: performance.now() - started,
      cacheState,
    });
    if (this.closed || this.busy) return result("failed", [this.closed ? "adapter-closed" : "concurrent-query"]);
    if (request.operation !== "references") return result("unsupported", ["unsupported-operation"]);
    if (resolve(request.workspaceRoot) !== this.snapshot.root) return result("failed", ["workspace-mismatch"]);
    const source =
      this.projectCapture && request.path
        ? this.projectCapture.source(request.path)
        : this.snapshot.sources.find((source) => source.path === request.path);
    const position = request.position;
    if (!source || !position || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
      return result("failed", ["invalid-request"]);
    }
    const lines = source.text.split("\n");
    const line = lines[position.line];
    if (
      !Number.isInteger(position.line) ||
      !Number.isInteger(position.character) ||
      !line ||
      position.character < 0 ||
      position.character >= line.replace(/\r$/, "").length
    ) {
      return result("failed", ["invalid-position"]);
    }
    if (!this.current()) return result("failed", ["stale-snapshot"]);
    const offset =
      lines.slice(0, position.line).reduce((length, line) => length + line.length + 1, 0) + position.character;
    this.busy = true;
    this.queried = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      return await Promise.race([
        this.analyze(source.path, offset, request.limit).then((observation) => {
          if (!this.current()) return result("failed", ["stale-snapshot"]);
          return result(
            observation.reasons.length ? "partial" : "complete",
            observation.reasons,
            observation.entries,
            observation.omittedCount,
            observation.diagnosticCodes,
          );
        }),
        new Promise<ReferenceEvidence>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve(result("failed", ["query-timeout"]));
          }, 15_000);
        }),
      ]);
    } catch {
      // Do not leak provider exceptions or absolute paths as result evidence.
      await this.close();
      return result("failed", ["compiler-query-failed"]);
    } finally {
      if (timer) clearTimeout(timer);
      if (timedOut) await this.close();
      this.busy = false;
    }
  }

  private current(): boolean {
    return this.projectCapture ? this.projectCapture.current() : isCurrent(this.snapshot);
  }

  private async analyze(
    path: string,
    offset: number,
    limit: number,
  ): Promise<{
    entries: ReferenceEvidence["entries"];
    reasons: string[];
    omittedCount: number;
    diagnosticCodes: number[];
  }> {
    const snapshot = await this.api.updateSnapshot({ openProjects: [this.configPath] });
    try {
      const project = snapshot.getProject(this.configPath);
      if (!project) throw new Error("project-unavailable");
      if (this.projectCapture) {
        this.rootFiles = project.rootFiles
          .map((path) => relative(this.snapshot.root, path).split(sep).join("/"))
          .sort();
        const options = project.program.getCompilerOptions();
        this.compilerOptionsDigest = digest(JSON.stringify(options));
        this.observedOptions = {
          target: options.target,
          module: options.module,
          moduleResolution: options.moduleResolution,
          strict: options.strict,
          noUncheckedIndexedAccess: options.noUncheckedIndexedAccess,
          exactOptionalPropertyTypes: options.exactOptionalPropertyTypes,
          types: options.types,
        };
      }
      const file = await project.program.getSourceFile(`${this.virtualRoot}/${path}`);
      if (!file) throw new Error("source-unavailable");
      const token = getTokenAtPosition(file, offset);
      if (!isIdentifier(token) || offset < token.getStart(file) || offset >= token.end) {
        return { entries: [], reasons: ["no-symbol-at-position"], omittedCount: 0, diagnosticCodes: [] };
      }
      const diagnostics = [
        ...(await project.program.getConfigFileParsingDiagnostics()),
        ...(await project.program.getProgramDiagnostics()),
        ...(await project.program.getGlobalDiagnostics()),
        ...(await project.program.getSyntacticDiagnostics()),
        ...(await project.program.getSemanticDiagnostics()),
      ];
      const diagnosticCodes = [
        ...new Set(diagnostics.filter((d) => d.category === DiagnosticCategory.Error).map((d) => d.code)),
      ].sort((a, b) => a - b);
      const groups = await project.checker.getReferencedSymbolsForNode(token, offset);
      const handles: NodeHandle[] = groups.flatMap((group) => [group.definition, ...group.references]);
      const entries = new Map<string, ReferenceEvidence["entries"][number]>();
      const reasons: string[] = diagnosticCodes.length ? ["compiler-diagnostics"] : [];
      if (!groups.length) reasons.push("unresolved-symbol");
      for (const handle of handles) {
        const resolved = await handle.resolve();
        const node =
          resolved &&
          (isFunctionDeclaration(resolved) ||
            isParameterDeclaration(resolved) ||
            isImportSpecifier(resolved) ||
            isExportSpecifier(resolved) ||
            isVariableDeclaration(resolved) ||
            isClassDeclaration(resolved) ||
            isInterfaceDeclaration(resolved) ||
            isTypeAliasDeclaration(resolved) ||
            isMethodDeclaration(resolved) ||
            isPropertyDeclaration(resolved) ||
            isTypeParameterDeclaration(resolved))
            ? resolved.name
            : resolved;
        const source = this.snapshot.sources.find((source) =>
          process.platform === "win32"
            ? `${this.virtualRoot}/${source.path}`.toLowerCase() === String(handle.path).toLowerCase()
            : `${this.virtualRoot}/${source.path}` === String(handle.path),
        );
        if (!node || !isIdentifier(node) || !source) {
          reasons.push("reference-outside-selected-files-or-unresolved");
          continue;
        }
        const sourceFile = await project.program.getSourceFile(String(handle.path));
        if (!sourceFile) {
          reasons.push("unresolved-reference-file");
          continue;
        }
        const start = node.getStart(sourceFile);
        const range = {
          start: sourceFile.getLineAndCharacterOfPosition(start),
          end: sourceFile.getLineAndCharacterOfPosition(node.end),
        };
        entries.set(`${source.path}:${start}:${node.end}`, {
          kind: "location",
          path: source.path,
          range,
          sourceHash: source.hash,
          symbol: source.text.slice(start, node.end),
        });
      }
      const all = [...entries.values()].sort(
        (a, b) =>
          (a.path ?? "").localeCompare(b.path ?? "") ||
          (a.range?.start.line ?? 0) - (b.range?.start.line ?? 0) ||
          (a.range?.start.character ?? 0) - (b.range?.start.character ?? 0),
      );
      const omittedCount = Math.max(0, all.length - limit);
      if (omittedCount) reasons.push("entry-limit");
      return {
        entries: all.slice(0, limit),
        reasons: [...new Set([...reasons, ...(this.projectCapture?.reasons ?? [])])],
        omittedCount,
        diagnosticCodes,
      };
    } finally {
      await snapshot.dispose();
    }
  }
}
