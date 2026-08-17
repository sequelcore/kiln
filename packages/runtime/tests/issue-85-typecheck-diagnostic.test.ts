import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

function printBase64(path: string, label: string): void {
  const encoded = readFileSync(path).toString("base64");
  console.error(`ISSUE_85_SOURCE_BEGIN ${label}`);
  for (let offset = 0; offset < encoded.length; offset += 8_000) {
    console.error(encoded.slice(offset, offset + 8_000));
  }
  console.error(`ISSUE_85_SOURCE_END ${label}`);
}

// Disposable probe: removed before review.
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
    printBase64("packages/runtime/tests/gateway/message-pipeline.test.ts", "message-pipeline.test.ts");
    printBase64("packages/runtime/tests/managed-agent/resource-provider.test.ts", "resource-provider.test.ts");
    throw new Error("issue 85 diagnostic probe intentionally fails");
  });
});