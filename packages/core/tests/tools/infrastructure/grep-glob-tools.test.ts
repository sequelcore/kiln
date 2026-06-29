import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GlobTool } from "../../../src/tools/infrastructure/glob-tool.js";
import { GrepTool } from "../../../src/tools/infrastructure/grep-tool.js";
import { resolveRipgrepRuntime } from "../../../src/tools/infrastructure/search-runtime.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./test-utils.js";

const boundedRgArgs = (maxCount: number): readonly string[] => [
  "--no-heading",
  "--line-number",
  "--max-count",
  String(maxCount),
  "--max-filesize",
  "1M",
  "--glob",
  "!**/.git/**",
  "--glob",
  "!**/.kiln/**",
  "--glob",
  "!**/node_modules/**",
  "--glob",
  "!**/dist/**",
  "--glob",
  "!**/build/**",
  "--glob",
  "!**/coverage/**",
  "--glob",
  "!**/.next/**",
  "--glob",
  "!**/.turbo/**",
];

describe("GrepTool", () => {
  it("fails fast when rg runtime is unavailable", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "one\nneedle line\nthree", "utf8");

      const tool = new GrepTool({
        searchRuntimeProvider: async () => undefined,
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "needle", path: tempDir, outputMode: "content" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("ripgrep runtime is required");
      expect(result.metadata?.["toolName"]).toBe("grep");
      expect(result.metadata?.["kind"]).toBe("search");
      expect(result.metadata?.["strategy"]).toBe("rg");
      expect(result.metadata?.["runtimeSource"]).toBe("unavailable");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("uses rg fast path when available", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/file.ts:12:match here\n",
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "match", path: ".", outputMode: "content" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/file.ts:12:match here");
    expect(result.metadata?.["toolName"]).toBe("grep");
    expect(result.metadata?.["kind"]).toBe("search");
    expect(result.metadata?.["strategy"]).toBe("rg");
    expect(result.metadata?.["runtimeSource"]).toBe("system");
    expect(result.metadata?.["runtimePath"]).toBe("rg-bin");
    expect(commandRunner).toHaveBeenCalledWith(
      "rg-bin",
      [...boundedRgArgs(200), "match", "."],
      process.cwd(),
      30_000,
    );
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it("falls back to literal matching when auto mode receives an invalid regex", async () => {
    const tempDir = await makeTempDir();
    try {
      const filePath = join(tempDir, "notes.txt");
      await writeFile(filePath, "literal value: **/*kiln-context*\n", "utf8");

      const commandRunner = vi.fn(async () => ({
        stdout: "notes.txt:1:literal value: **/*kiln-context*\n",
        stderr: "",
      }));
      const tool = new GrepTool({
        searchRuntimeProvider: async () => ({
          path: "rg-bin",
          version: "15.0.0",
          source: "system",
        }),
        commandRunner,
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "**/*kiln-context*", path: filePath, outputMode: "content" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("notes.txt:1:literal value: **/*kiln-context*");
      expect(result.metadata?.["strategy"]).toBe("rg");
      expect(result.metadata?.["matchMode"]).toBe("literal");
      expect(commandRunner).toHaveBeenCalledWith(
        "rg-bin",
        [...boundedRgArgs(200), "--fixed-strings", "**/*kiln-context*", "notes.txt"],
        tempDir,
        30_000,
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("passes fixed-string mode to rg when literal matching is requested", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/file.ts:12:literal (value\n",
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "literal (value", path: ".", outputMode: "content", matchMode: "literal" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/file.ts:12:literal (value");
    expect(result.metadata?.["matchMode"]).toBe("literal");
    expect(commandRunner).toHaveBeenCalledWith(
      "rg-bin",
      [...boundedRgArgs(200), "--fixed-strings", "literal (value", "."],
      process.cwd(),
      30_000,
    );
  });

  it("keeps explicit regex mode strict for invalid regular expressions", async () => {
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "**/*kiln-context*", path: ".", outputMode: "content", matchMode: "regex" },
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("valid regular expression");
  });

  it("limits fast path content results by default and records truncation metadata", async () => {
    const stdout = Array.from({ length: 205 }, (_, index) => `src/file.ts:${index + 1}:match`).join("\n") + "\n";
    const commandRunner = vi.fn(async () => ({
      stdout,
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "match", path: ".", outputMode: "content" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/file.ts:200:match");
    expect(result.output).not.toContain("src/file.ts:201:match");
    expect(result.output).toContain("[grep results truncated: returned 200 of 205 matches");
    expect(result.metadata?.["count"]).toBe(200);
    expect(result.metadata?.["totalCount"]).toBe(205);
    expect(result.metadata?.["maxResults"]).toBe(200);
    expect(result.metadata?.["truncated"]).toBe(true);
  });

  it("passes explicit maxResults to rg as an execution bound", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/file.ts:1:match\nsrc/file.ts:2:match\n",
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "match", path: ".", outputMode: "content", maxResults: 2 },
    });

    expect(result.isError).toBe(false);
    expect(commandRunner).toHaveBeenCalledWith(
      "rg-bin",
      [...boundedRgArgs(2), "match", "."],
      process.cwd(),
      30_000,
    );
  });

  it("honors explicit maxResults for fast path output", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/file.ts:1:match\nsrc/file.ts:2:match\nsrc/file.ts:3:match\n",
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "match", path: ".", outputMode: "content", maxResults: 2 },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/file.ts:2:match");
    expect(result.output).not.toContain("src/file.ts:3:match");
    expect(result.metadata?.["count"]).toBe(2);
    expect(result.metadata?.["totalCount"]).toBe(3);
    expect(result.metadata?.["maxResults"]).toBe(2);
    expect(result.metadata?.["truncated"]).toBe(true);
  });

  it("does not cap per-file counts when count output is requested", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/file.ts:125\n",
      stderr: "",
    }));
    const tool = new GrepTool({
      environmentProvider: async () => ({
        rg: { path: "rg-bin", version: "15.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "grep",
      input: { pattern: "match", path: ".", outputMode: "count", maxResults: 2 },
    });

    expect(result.isError).toBe(false);
    const [, args] = commandRunner.mock.calls[0] ?? [];
    expect(args).toContain("--count");
    expect(args).not.toContain("--max-count");
  });

  it("does not fall back to the internal scanner when rg fails to launch", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "a.txt"), "one\nneedle line\nthree", "utf8");
      const commandRunner = vi.fn(async () => {
        throw Object.assign(new Error("ENOENT: no such file or directory, uv_spawn 'rg.exe'"), {
          code: "ENOENT",
          stdout: "",
          stderr: "",
        });
      });
      const tool = new GrepTool({
        searchRuntimeProvider: async () => ({
          path: "rg-bin",
          version: "15.0.0",
          source: "system",
        }),
        commandRunner,
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "needle", path: tempDir, outputMode: "content" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("ENOENT");
      expect(result.output).not.toContain("a.txt:2:needle line");
      expect(result.metadata?.["strategy"]).toBe("rg");
      expect(result.metadata?.["runtimeSource"]).toBe("system");
      expect(commandRunner).toHaveBeenCalledTimes(1);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("uses the parent directory as cwd when grep path is a file", async () => {
    const tempDir = await makeTempDir();
    try {
      const filePath = join(tempDir, "notes.txt");
      await writeFile(filePath, "needle line\n", "utf8");

      const commandRunner = vi.fn(async () => ({
        stdout: "notes.txt:1:needle line\n",
        stderr: "",
      }));
      const tool = new GrepTool({
        environmentProvider: async () => ({
          rg: { path: "rg-bin", version: "15.0.0" },
        }),
        vendoredToolResolver: () => undefined,
        commandRunner,
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "needle", path: filePath, outputMode: "content" },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("notes.txt:1:needle line");
      expect(commandRunner).toHaveBeenCalledWith(
        "rg-bin",
        [...boundedRgArgs(200), "needle", "notes.txt"],
        tempDir,
        30_000,
      );
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("respects sandbox read validation for search root", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new GrepTool({
        environmentProvider: async () => ({}),
      });

      const result = await tool.execute(
        {
          name: "grep",
          input: { pattern: "needle", path: tempDir, outputMode: "content" },
        },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});

describe("resolveRipgrepRuntime", () => {
  it("prefers bundled rg over configured and system runtimes", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "ripgrep 15.0.0\n",
      stderr: "",
    }));

    const runtime = await resolveRipgrepRuntime({
      bundledPath: "bundled-rg",
      configuredPath: "configured-rg",
      commandRunner,
      vendoredToolResolver: () => undefined,
      environmentProvider: async () => ({
        rg: { path: "system-rg", version: "ripgrep 14.1.1" },
      }),
    });

    expect(runtime).toEqual({
      path: "bundled-rg",
      version: "ripgrep 15.0.0",
      source: "bundled",
    });
    expect(commandRunner).toHaveBeenCalledWith("bundled-rg", ["--version"], process.cwd(), 1_500);
  });

  it("uses vendored rg as bundled runtime before configured and system runtimes", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "ripgrep 15.0.0\n",
      stderr: "",
    }));

    const runtime = await resolveRipgrepRuntime({
      configuredPath: "configured-rg",
      commandRunner,
      vendoredToolResolver: () => ({ path: "vendored-rg" }),
      environmentProvider: async () => ({
        rg: { path: "system-rg", version: "ripgrep 14.1.1" },
      }),
    });

    expect(runtime).toEqual({
      path: "vendored-rg",
      version: "ripgrep 15.0.0",
      source: "bundled",
    });
    expect(commandRunner).toHaveBeenCalledWith("vendored-rg", ["--version"], process.cwd(), 1_500);
  });

  it("uses configured rg when no bundled runtime is present", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "ripgrep 15.0.0\nfeatures:+pcre2\n",
      stderr: "",
    }));

    const runtime = await resolveRipgrepRuntime({
      configuredPath: "configured-rg",
      commandRunner,
      vendoredToolResolver: () => undefined,
      environmentProvider: async () => ({}),
    });

    expect(runtime).toEqual({
      path: "configured-rg",
      version: "ripgrep 15.0.0",
      source: "configured",
    });
  });

  it("reports system rg from detected tool environment", async () => {
    const commandRunner = vi.fn();

    const runtime = await resolveRipgrepRuntime({
      commandRunner,
      vendoredToolResolver: () => undefined,
      environmentProvider: async () => ({
        rg: { path: "system-rg", version: "ripgrep 14.1.1" },
      }),
    });

    expect(runtime).toEqual({
      path: "system-rg",
      version: "ripgrep 14.1.1",
      source: "system",
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

describe("GlobTool", () => {
  it("uses fallback walker when fd is unavailable", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "match.ts"), "const x = 1;\n", "utf8");
      await writeFile(join(tempDir, "src", "skip.js"), "const y = 2;\n", "utf8");

      const tool = new GlobTool({
        environmentProvider: async () => ({}),
        vendoredToolResolver: () => undefined,
      });

      const result = await tool.execute(
        {
          name: "glob",
          input: { pattern: "**/*.ts", path: tempDir },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("src/match.ts");
      expect(result.output).not.toContain("skip.js");
      expect(result.metadata?.["toolName"]).toBe("glob");
      expect(result.metadata?.["kind"]).toBe("search");
      expect(result.metadata?.["strategy"]).toBe("fallback");
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("matches brace alternates consistently in the fallback walker", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "layout.css"), "body {}\n", "utf8");
      await writeFile(join(tempDir, "src", "view.tsx"), "export const View = () => null;\n", "utf8");
      await writeFile(join(tempDir, "src", "model.ts"), "export const model = true;\n", "utf8");
      await writeFile(join(tempDir, "src", "notes.md"), "# notes\n", "utf8");

      const tool = new GlobTool({
        environmentProvider: async () => ({}),
        vendoredToolResolver: () => undefined,
      });

      const result = await tool.execute(
        {
          name: "glob",
          input: { pattern: "src/**/*.{css,tsx,ts}", path: tempDir },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("src/layout.css");
      expect(result.output).toContain("src/view.tsx");
      expect(result.output).toContain("src/model.ts");
      expect(result.output).not.toContain("src/notes.md");
      expect(result.metadata?.["count"]).toBe(3);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("uses fd fast path when available", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/one.ts\nsrc/two.ts\n",
      stderr: "",
    }));
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "**/*.ts", path: "." },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("src/one.ts");
    expect(result.metadata?.["toolName"]).toBe("glob");
    expect(result.metadata?.["kind"]).toBe("search");
    expect(result.metadata?.["strategy"]).toBe("fd");
    expect(commandRunner).toHaveBeenCalledWith(
      "fd-bin",
      ["--glob", "--type", "f", "**/*.ts", "."],
      process.cwd(),
      30_000,
    );
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it("uses vendored fd before system fd when available", async () => {
    const commandRunner = vi.fn(async () => ({
      stdout: "src/one.ts\n",
      stderr: "",
    }));
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "system-fd", version: "9.0.0" },
      }),
      vendoredToolResolver: (binary) =>
        binary === "fd" ? { path: "vendored-fd", version: "10.4.2" } : undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "**/*.ts", path: "." },
    });

    expect(result.isError).toBe(false);
    expect(result.metadata?.["strategy"]).toBe("fd");
    expect(result.metadata?.["runtimeSource"]).toBe("bundled");
    expect(result.metadata?.["runtimePath"]).toBe("vendored-fd");
    expect(result.metadata?.["runtimeVersion"]).toBe("10.4.2");
    expect(commandRunner).toHaveBeenCalledWith(
      "vendored-fd",
      ["--glob", "--type", "f", "**/*.ts", "."],
      process.cwd(),
      30_000,
    );
  });

  it("falls back to the internal walker when fd fails to launch", async () => {
    const tempDir = await makeTempDir();
    try {
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "match.ts"), "const x = 1;\n", "utf8");
      await writeFile(join(tempDir, "src", "skip.js"), "const y = 2;\n", "utf8");
      const commandRunner = vi.fn(async () => {
        throw Object.assign(new Error("ENOENT: no such file or directory, uv_spawn 'fd.exe'"), {
          code: "ENOENT",
          stdout: "",
          stderr: "",
        });
      });
      const tool = new GlobTool({
        environmentProvider: async () => ({
          fd: { path: "fd-bin", version: "10.0.0" },
        }),
        vendoredToolResolver: () => undefined,
        commandRunner,
      });

      const result = await tool.execute(
        {
          name: "glob",
          input: { pattern: "**/*.ts", path: tempDir },
        },
        makeSandbox(tempDir),
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain("src/match.ts");
      expect(result.output).not.toContain("skip.js");
      expect(result.metadata?.["strategy"]).toBe("fallback");
      expect(commandRunner).toHaveBeenCalledTimes(1);
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("expands brace alternates before calling fd so fast path matches fallback semantics", async () => {
    const commandRunner = vi.fn(async (_binary: string, args: readonly string[], cwd: string) => {
      if (cwd.endsWith("src") && args[3] === "**/*.css") {
        return { stdout: "layout.css\n", stderr: "" };
      }
      if (cwd.endsWith("src") && args[3] === "**/*.tsx") {
        return { stdout: "view.tsx\n", stderr: "" };
      }
      if (cwd.endsWith("src") && args[3] === "**/*.ts") {
        return { stdout: "model.ts\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "src/**/*.{css,tsx,ts}", path: ".", verbosity: "summary" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("3 matches:");
    expect(result.output).toContain("src/layout.css");
    expect(result.output).toContain("src/view.tsx");
    expect(result.output).toContain("src/model.ts");
    expect(result.metadata?.["count"]).toBe(3);
    expect(commandRunner).toHaveBeenNthCalledWith(
      1,
      "fd-bin",
      ["--glob", "--type", "f", "**/*.css", "."],
      join(process.cwd(), "src"),
      30_000,
    );
    expect(commandRunner).toHaveBeenNthCalledWith(
      2,
      "fd-bin",
      ["--glob", "--type", "f", "**/*.tsx", "."],
      join(process.cwd(), "src"),
      30_000,
    );
    expect(commandRunner).toHaveBeenNthCalledWith(
      3,
      "fd-bin",
      ["--glob", "--type", "f", "**/*.ts", "."],
      join(process.cwd(), "src"),
      30_000,
    );
  });

  it("matches multiple brace groups with literal directory prefixes in fd fast path", async () => {
    const commandRunner = vi.fn(async (_binary: string, args: readonly string[], cwd: string) => {
      if (cwd.endsWith(join("packages", "gui")) && args[3] === "**/*.tsx") {
        return { stdout: "src/components/app-shell.tsx\n", stderr: "" };
      }
      if (cwd.endsWith(join("packages", "studio")) && args[3] === "**/*.css") {
        return { stdout: "src/styles/tokens.css\n", stderr: "" };
      }
      throw Object.assign(new Error("no matches"), { code: 1, stdout: "", stderr: "" });
    });
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: {
        pattern: "packages/{gui,studio,widget,tui}/**/*.{tsx,ts,css,scss}",
        path: ".",
        verbosity: "raw",
      },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("packages/gui/src/components/app-shell.tsx");
    expect(result.output).toContain("packages/studio/src/styles/tokens.css");
    expect(result.metadata?.["count"]).toBe(2);
  });

  it("preserves path glob semantics for fd fast path when the globbed segment is before a slash", async () => {
    const commandRunner = vi.fn(async (_binary: string, args: readonly string[]) => {
      if (args[3] === "package.json") {
        return {
          stdout: [
            "t1code/package.json",
            "t1code/apps/web/package.json",
            "opencode/package.json",
            "opencode/packages/app/package.json",
          ].join("\n") + "\n",
          stderr: "",
        };
      }
      throw Object.assign(new Error("unexpected fd invocation"), { code: 1, stdout: "", stderr: "" });
    });
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "*/package.json", path: ".", verbosity: "raw" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("t1code/package.json");
    expect(result.output).toContain("opencode/package.json");
    expect(result.output).not.toContain("t1code/apps/web/package.json");
    expect(result.output).not.toContain("opencode/packages/app/package.json");
    expect(result.metadata?.["count"]).toBe(2);
    expect(commandRunner).toHaveBeenCalledWith(
      "fd-bin",
      ["--glob", "--type", "f", "package.json", "."],
      process.cwd(),
      30_000,
    );
  });

  it("preserves path glob semantics for fd fast path under a literal monorepo prefix", async () => {
    const commandRunner = vi.fn(async (_binary: string, args: readonly string[], cwd: string) => {
      if (cwd.endsWith("packages") && args[3] === "package.json") {
        return {
          stdout: [
            "gui/package.json",
            "gui/examples/demo/package.json",
            "runtime/package.json",
            "runtime/fixtures/package.json",
          ].join("\n") + "\n",
          stderr: "",
        };
      }
      throw Object.assign(new Error("unexpected fd invocation"), { code: 1, stdout: "", stderr: "" });
    });
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "packages/*/package.json", path: ".", verbosity: "raw" },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("packages/gui/package.json");
    expect(result.output).toContain("packages/runtime/package.json");
    expect(result.output).not.toContain("packages/gui/examples/demo/package.json");
    expect(result.output).not.toContain("packages/runtime/fixtures/package.json");
    expect(result.metadata?.["count"]).toBe(2);
    expect(commandRunner).toHaveBeenCalledWith(
      "fd-bin",
      ["--glob", "--type", "f", "package.json", "."],
      join(process.cwd(), "packages"),
      30_000,
    );
  });

  it("treats fd exit code 1 as a no-match success", async () => {
    const commandRunner = vi.fn(
      async () =>
        await Promise.reject({
          code: 1,
          stdout: "",
          stderr: "",
          message: "no matches",
        }),
    );
    const tool = new GlobTool({
      environmentProvider: async () => ({
        fd: { path: "fd-bin", version: "10.0.0" },
      }),
      vendoredToolResolver: () => undefined,
      commandRunner,
    });

    const result = await tool.execute({
      name: "glob",
      input: { pattern: "**/*.missing", path: "." },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toBe("");
    expect(result.metadata?.["strategy"]).toBe("fd");
    expect(result.metadata?.["noMatches"]).toBe(true);
  });

  it("respects sandbox read validation for search root", async () => {
    const tempDir = await makeTempDir();
    try {
      const tool = new GlobTool({
        environmentProvider: async () => ({}),
        vendoredToolResolver: () => undefined,
      });

      const result = await tool.execute(
        {
          name: "glob",
          input: { pattern: "**/*.ts", path: tempDir },
        },
        makeSandbox(tempDir, { fsPolicy: "none" }),
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Read access denied");
    } finally {
      await removeTempDir(tempDir);
    }
  });
});
