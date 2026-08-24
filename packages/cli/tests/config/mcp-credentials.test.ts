import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpCredentialAccess, KILN_MCP_SECRET_KEY_ENV } from "../../src/config/mcp-credentials.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("MCP credential access", () => {
  it("encrypts referenced values at rest and resolves them only with the operator master key", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-credentials-"));
    roots.push(root);
    const kilnHome = join(root, ".kiln");
    const access = createMcpCredentialAccess({ [KILN_MCP_SECRET_KEY_ENV]: "master-key" }, kilnHome);

    access.set("studio-token", "sensitive-value");

    expect(access.exists("studio-token")).toBe(true);
    expect(access.resolve("studio-token")).toBe("sensitive-value");
    expect(readFileSync(join(kilnHome, "mcp-secrets.json"), "utf-8")).not.toContain("sensitive-value");
  });

  it("fails closed when the master key is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-no-key-"));
    roots.push(root);
    const access = createMcpCredentialAccess({}, join(root, ".kiln"));
    expect(access.available).toBe(false);
    expect(access.exists("missing")).toBe(false);
    expect(() => access.set("missing", "value")).toThrow(KILN_MCP_SECRET_KEY_ENV);
  });
});
