import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
) as {
  exports?: Record<string, unknown>;
  main?: string;
  module?: string;
  types?: string;
  unpkg?: string;
};

beforeAll(() => {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(build.stderr);
  }
});

describe("published widget artifacts", () => {
  it("exports an ESM entrypoint with declarations", () => {
    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.module).toBe("./dist/index.js");
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.exports).toMatchObject({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    });
    expect(existsSync(resolve(packageRoot, "dist/index.js"))).toBe(true);
    expect(existsSync(resolve(packageRoot, "dist/index.d.ts"))).toBe(true);
    expect(manifest.exports).not.toHaveProperty("./browser");
  });

  it("imports the ESM API in a non-DOM process without auto-initializing", () => {
    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "await import('./dist/index.js')"],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(imported.stderr).toBe("");
    expect(imported.status).toBe(0);
  });

  it("ships a standalone browser IIFE and documents its published path", () => {
    expect(manifest.unpkg).toBe("./dist/widget.iife.js");
    const iife = readFileSync(resolve(packageRoot, "dist/widget.iife.js"), "utf8");
    const readme = readFileSync(resolve(packageRoot, "README.md"), "utf8");
    expect(iife).toMatch(/^\(\(\)=>\{/);
    expect(iife).toContain("kiln-widget");
    expect(iife).not.toMatch(/^\s*(?:import|export)\s/m);
    expect(readme).toContain("dist/widget.iife.js");
    expect(readme).not.toContain("dist/widget.js");
  });
});
