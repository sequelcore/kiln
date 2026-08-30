import { describe, expect, it } from "vitest";
import { analyzeArchitectureSnapshot } from "./report-architecture-baseline.js";

function fixtureFiles(): ReadonlyMap<string, string> {
  return new Map([
    ["packages/core/package.json", JSON.stringify({ name: "@kilnai/core" })],
    ["packages/core/src/index.ts", 'export { engineValue } from "./engine/index.js";'],
    ["packages/core/src/engine/index.ts", "export const engineValue = 1;"],
    ["packages/runtime/package.json", JSON.stringify({ name: "@kilnai/runtime" })],
    ["packages/runtime/src/index.ts", "export const runtimeValue = 1;"],
    ["packages/cli/package.json", JSON.stringify({ name: "@kilnai/cli" })],
    ["packages/cli/src/executable.ts", [
      'import { engineValue } from "@kilnai/core";',
      'import type { RuntimeType } from "@kilnai/runtime";',
      "export {",
      "  helper,",
      '} from "./helper.js";',
      'export type { DeferredType } from "./types.js";',
      '// import { ignored } from "@kilnai/runtime";',
      'const example = `import { ignored } from "@kilnai/runtime";`;',
      'void import("./commands/heavy.js");',
      "console.log(engineValue);",
    ].join("\n")],
    ["packages/cli/src/helper.ts", 'import { runtimeValue } from "@kilnai/runtime"; export const helper = runtimeValue;'],
    ["packages/cli/src/types.ts", "export interface DeferredType { readonly value: string }"],
    ["packages/cli/src/commands/heavy.ts", 'import "external-heavy";'],
    ["packages/cli/tests/root-import.test.ts", 'import type { CoreType } from "@kilnai/core";'],
  ]);
}

describe("architecture baseline report", () => {
  it("classifies package-root imports by consumer, surface, and load", () => {
    const report = analyzeArchitectureSnapshot(fixtureFiles(), "abc123");

    expect(report.rootImports).toEqual([
      {
        target: "@kilnai/core",
        consumer: "@kilnai/cli",
        surface: "production",
        load: "eager-runtime",
        fileCount: 1,
        occurrenceCount: 1,
      },
      {
        target: "@kilnai/core",
        consumer: "@kilnai/cli",
        surface: "test",
        load: "type-only",
        fileCount: 1,
        occurrenceCount: 1,
      },
      {
        target: "@kilnai/runtime",
        consumer: "@kilnai/cli",
        surface: "production",
        load: "eager-runtime",
        fileCount: 1,
        occurrenceCount: 1,
      },
      {
        target: "@kilnai/runtime",
        consumer: "@kilnai/cli",
        surface: "production",
        load: "type-only",
        fileCount: 1,
        occurrenceCount: 1,
      },
    ]);
  });

  it("traces eager workspace modules while keeping literal dynamic imports deferred", () => {
    const report = analyzeArchitectureSnapshot(fixtureFiles(), "abc123");

    expect(report.cliEagerGraph).toMatchObject({
      workspaceModuleCount: 5,
      modulesByPackage: {
        "@kilnai/cli": 2,
        "@kilnai/core": 2,
        "@kilnai/runtime": 1,
      },
      rootWorkspaceImports: [
        "packages/cli/src/executable.ts -> @kilnai/core",
        "packages/cli/src/helper.ts -> @kilnai/runtime",
      ],
      deferredDynamicImports: [
        "packages/cli/src/executable.ts -> ./commands/heavy.js",
      ],
      externalSpecifiers: [],
      unresolvedWorkspaceEdges: [],
    });
  });
});
