import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("issue 85 diagnostic probe", () => {
  it("prints targeted runtime test typecheck diagnostics", () => {
    let output = "";
    try {
      output = execFileSync(
        "npx",
        ["tsc", "-p", "packages/runtime/tsconfig.test.json"],
        { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const failure = error as { readonly stdout?: string; readonly stderr?: string };
      output = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
    }
    const targeted = output
      .split(/\r?\n/u)
      .filter((line) => line.includes("message-pipeline.test.ts") || line.includes("managed-agent/resource-provider.test.ts"));
    console.error(`ISSUE_85_TARGET_DIAGNOSTICS\n${targeted.join("\n")}`);
    throw new Error("issue 85 diagnostic probe intentionally fails");
  });
});
