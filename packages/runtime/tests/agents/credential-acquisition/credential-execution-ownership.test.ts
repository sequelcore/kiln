import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("credential execution ownership", () => {
  it("keeps concrete authenticators and credential filesystem helpers out of Core", () => {
    const coreInfrastructure = resolve(import.meta.dirname, "../../../../core/src/agents/infrastructure");
    for (const fileName of ["codex-oauth-auth.ts", "opencode-auth.ts", "credential-file-mode.ts"]) {
      expect(existsSync(resolve(coreInfrastructure, fileName)), fileName).toBe(false);
    }
    const coreAgentsSurface = readFileSync(
      resolve(import.meta.dirname, "../../../../core/src/agents/index.ts"),
      "utf8",
    );
    expect(coreAgentsSurface).not.toMatch(/CodexOAuthAuth|OpenCodeAuth|CREDENTIAL_FILE_MODE/u);
  });

  it("keeps CLI auth limited to application requests and presentation", () => {
    const cliAuth = readFileSync(
      resolve(import.meta.dirname, "../../../../cli/src/commands/auth.ts"),
      "utf8",
    );
    expect(cliAuth).not.toMatch(/node:(?:crypto|fs|path)/u);
    expect(cliAuth).not.toMatch(/CREDENTIAL_FILE_MODE|OpenCodeAuth|CodexOAuthAuth/u);
    expect(cliAuth).not.toMatch(/\b(?:readFile|writeFile|readdir|rename|unlink)\b/u);
  });

  it("does not publish credential stores or filesystem helpers from Runtime", () => {
    const runtimeSurface = readFileSync(
      resolve(import.meta.dirname, "../../../src/index.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toMatch(/CredentialFileStore|listOverPermissiveCredentialFiles/u);
    expect(runtimeSurface).not.toMatch(/CREDENTIAL_FILE_MODE|applyCredentialFileMode|isOverPermissiveCredentialMode/u);
  });
});
