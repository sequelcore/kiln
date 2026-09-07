import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ProjectCapture } from "./project-capture.js";
import { TypeScriptReferenceAdapter } from "./reference-adapter.js";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-project-analysis-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        types: [],
        verbatimModuleSyntax: true,
      },
    }),
    "app/tsconfig.json": '{"extends":"../tsconfig.json","include":["src"],"exclude":["src/excluded.ts"]}',
    "app/src/origin.ts": "export function calculate(value: number): number { return value + 1; }\n",
    "app/src/consumer.ts": 'import { calculate } from "./origin.js";\nexport const result = calculate(1);\n',
    "app/src/excluded.ts": 'import { calculate } from "./origin.js";\nexport const excluded = calculate(2);\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe", windowsHide: true, timeout: 5000 });
  };
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "Project fixture",
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), "kiln-project-analysis-"))) throw new Error("unsafe-cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

function request(root: string) {
  return {
    operation: "references" as const,
    workspaceRoot: root,
    path: "app/src/origin.ts",
    position: { line: 0, character: 16 },
    limit: 100,
  };
}

test("owning include/exclude, inherited options and package metadata determine the project", async () => {
  const root = fixture();
  const capture = new ProjectCapture(root, "app/tsconfig.json");
  const adapter = new TypeScriptReferenceAdapter(capture);
  try {
    const result = await adapter.query(request(root));
    expect(result.disposition, JSON.stringify(result.reasons)).toBe("complete");
    expect(result.entries.map((entry) => [entry.path, entry.range?.start])).toEqual([
      ["app/src/consumer.ts", { line: 0, character: 9 }],
      ["app/src/consumer.ts", { line: 1, character: 22 }],
      ["app/src/origin.ts", { line: 0, character: 16 }],
    ]);
    expect(result.project?.rootFiles).toEqual(["app/src/consumer.ts", "app/src/origin.ts"]);
    expect(result.project?.options["strict"]).toBe(true);
    expect(result.project?.inputs.map((input) => input.path)).toEqual(
      expect.arrayContaining(["tsconfig.json", "app/tsconfig.json", "package.json"]),
    );
    expect(result.project?.inputs.some((input) => input.path.endsWith("excluded.ts"))).toBe(false);
  } finally {
    await adapter.close();
  }
}, 30_000);

test("changing inherited config or a previously absent included file invalidates the capture", async () => {
  const root = fixture();
  const capture = new ProjectCapture(root, "app/tsconfig.json");
  const adapter = new TypeScriptReferenceAdapter(capture);
  try {
    expect((await adapter.query(request(root))).disposition).toBe("complete");
    const base = readFileSync(join(root, "tsconfig.json"), "utf8");
    writeFileSync(join(root, "tsconfig.json"), base.replace('"strict":true', '"strict":false'));
    expect(capture.current()).toBe(false);
    expect((await adapter.query(request(root))).reasons).toEqual(["stale-snapshot"]);
    writeFileSync(join(root, "tsconfig.json"), base);
    writeFileSync(join(root, "app/src/added.ts"), "export const added = 1;\n");
    expect(capture.current()).toBe(false);
  } finally {
    await adapter.close();
  }
}, 30_000);

test("inherited strictness and module package type affect diagnostics without overrides", async () => {
  const root = fixture();
  writeFileSync(join(root, "app/src/invalid.ts"), "export const invalid: string = null;\n");
  const strict = new TypeScriptReferenceAdapter(new ProjectCapture(root, "app/tsconfig.json"));
  try {
    const result = await strict.query(request(root));
    expect(result.disposition).toBe("partial");
    expect(result.diagnosticCodes).toContain(2322);
  } finally {
    await strict.close();
  }
  const base = readFileSync(join(root, "tsconfig.json"), "utf8");
  writeFileSync(join(root, "tsconfig.json"), base.replace('"strict":true', '"strict":false'));
  const relaxed = new TypeScriptReferenceAdapter(new ProjectCapture(root, "app/tsconfig.json"));
  try {
    expect((await relaxed.query(request(root))).disposition).toBe("complete");
  } finally {
    await relaxed.close();
  }
  writeFileSync(join(root, "package.json"), '{"type":"commonjs"}');
  const commonjs = new TypeScriptReferenceAdapter(new ProjectCapture(root, "app/tsconfig.json"));
  try {
    const result = await commonjs.query(request(root));
    expect(result.disposition).toBe("partial");
    expect(result.diagnosticCodes.length).toBeGreaterThan(0);
  } finally {
    await commonjs.close();
  }
}, 30_000);

test("missing installed declarations remain partial instead of dropping inherited types", async () => {
  const root = fixture();
  const base = readFileSync(join(root, "tsconfig.json"), "utf8");
  writeFileSync(join(root, "tsconfig.json"), base.replace('"types":[]', '"types":["missing-fixture-types"]'));
  const adapter = new TypeScriptReferenceAdapter(new ProjectCapture(root, "app/tsconfig.json"));
  try {
    const result = await adapter.query(request(root));
    expect(result.disposition).toBe("partial");
    expect(result.diagnosticCodes).toContain(2688);
  } finally {
    await adapter.close();
  }
}, 30_000);

test("read callbacks neither escape symlinks nor fall back to the ambient filesystem", () => {
  const root = fixture();
  const other = fixture();
  const link = join(root, "outside");
  symlinkSync(other, link, process.platform === "win32" ? "junction" : "dir");
  try {
    const capture = new ProjectCapture(root, "app/tsconfig.json");
    expect(capture.fileSystem.readFile?.(join(link, "tsconfig.json"))).toBeNull();
    expect(capture.fileSystem.readFile?.(join(other, "tsconfig.json"))).toBeNull();
    expect(capture.reasons).toContain("workspace-read-refused");
    expect(capture.inputs.map((input) => input.path)).toEqual(["app/tsconfig.json"]);
  } finally {
    unlinkSync(link);
  }
});

test("byte changes cannot hide behind UTF-8 replacement during revalidation", () => {
  const root = fixture();
  const path = join(root, "app/src/unicode.ts");
  writeFileSync(path, "\ufffd");
  const capture = new ProjectCapture(root, "app/tsconfig.json");
  expect(capture.source("app/src/unicode.ts")?.text).toBe("\ufffd");
  writeFileSync(path, Buffer.from([0xf0, 0x9f, 0x92]));
  expect(readFileSync(path, "utf8")).toBe("\ufffd");
  expect(capture.current()).toBe(false);
});

test("oversized project inputs and unsupported file content refuse before reading", () => {
  const root = fixture();
  const oversized = join(root, "app/src/large.ts");
  writeFileSync(oversized, " ".repeat(33_554_433));
  const unsupported = join(root, "app/src/private.pem");
  writeFileSync(unsupported, "not-an-analysis-input");
  const capture = new ProjectCapture(root, "app/tsconfig.json");
  expect(capture.fileSystem.readFile?.(oversized)).toBeNull();
  expect(capture.fileSystem.readFile?.(unsupported)).toBeNull();
  expect(capture.reasons).toEqual(["project-input-budget", "unsupported-project-input"]);
  expect(capture.inputs.map((input) => input.path)).toEqual(["app/tsconfig.json"]);
});

test("capturing Git identity does not invoke a configured fsmonitor hook", () => {
  const root = fixture();
  const hook = join(root, ".git", "analysis-fsmonitor");
  const marker = join(root, "fsmonitor-ran");
  writeFileSync(hook, '#!/bin/sh\necho ran > fsmonitor-ran\nprintf "token\\0"\n');
  chmodSync(hook, 0o755);
  execFileSync("git", ["-C", root, "config", "core.fsmonitor", hook.replaceAll("\\", "/")], { windowsHide: true });
  // Positive control proves this Git installation would otherwise execute it.
  execFileSync("git", ["-C", root, "status", "--porcelain"], { stdio: "pipe", windowsHide: true, timeout: 5000 });
  expect(existsSync(marker)).toBe(true);
  rmSync(marker);
  const capture = new ProjectCapture(root, "app/tsconfig.json");
  expect(capture.current()).toBe(true);
  expect(existsSync(marker)).toBe(false);
});

test("unadmitted referenced projects retain an explicit coverage limit", async () => {
  const root = fixture();
  writeFileSync(
    join(root, "app/tsconfig.json"),
    '{"extends":"../tsconfig.json","include":["src"],"references":[{"path":"../missing"}]}',
  );
  const adapter = new TypeScriptReferenceAdapter(new ProjectCapture(root, "app/tsconfig.json"));
  try {
    const result = await adapter.query(request(root));
    expect(result.disposition).not.toBe("complete");
    expect(result.reasons).toContain("project-reference-coverage-unproven");
  } finally {
    await adapter.close();
  }
}, 30_000);
