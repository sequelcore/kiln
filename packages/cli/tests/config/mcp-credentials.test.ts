import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedMcpServer } from "@kilnai/core/mcp";
import {
  deriveMcpServerBindingDigest,
  MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION,
} from "@kilnai/core/capabilities";
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

  it("computes an opaque stable authorization context for literal and environment references", () => {
    const key = Buffer.alloc(32, 7);
    const server = resolvedServer({
      env: {
        MODE: { value: "production" },
        REGION: { fromEnv: "MCP_REGION" },
      },
      headers: {
        "x-client": { value: "kiln" },
      },
    });
    const environment = { MCP_REGION: "us-east-1" };
    const access = createMcpCredentialAccess(environment, mkdtemp("kiln-mcp-auth-"), { authorizationKey: key });
    const reorderedServer = resolvedServer({
      env: {
        REGION: { fromEnv: "MCP_REGION" },
        MODE: { value: "production" },
      },
      headers: {
        "x-client": { value: "kiln" },
      },
    });

    const evidence = access.acquireAuthorizationContext(server).evidence;
    expect(evidence.revision).toBe(MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION);
    expect(evidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(access.acquireAuthorizationContext(reorderedServer).evidence).toEqual(evidence);
    expect(JSON.stringify(evidence)).not.toContain("production");
    expect(JSON.stringify(evidence)).not.toContain("us-east-1");
  });

  it("rotates authorization context when a resolved value or key changes", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-auth-rotation-"));
    roots.push(root);
    const kilnHome = join(root, ".kiln");
    const key = Buffer.alloc(32, 11);
    const environment = { [KILN_MCP_SECRET_KEY_ENV]: "master-key", MCP_REGION: "us-east-1" };
    const server = resolvedServer({
      env: { REGION: { fromEnv: "MCP_REGION" } },
      headers: {
        authorization: { fromCredential: "studio-token" },
        "x-mode": { value: "initial" },
      },
    });
    const access = createMcpCredentialAccess(environment, kilnHome, { authorizationKey: key });
    access.set("studio-token", "credential-initial");
    const initial = access.acquireAuthorizationContext(server).evidence;

    const changedEnvironment = createMcpCredentialAccess(
      { ...environment, MCP_REGION: "eu-west-1" },
      kilnHome,
      { authorizationKey: key },
    ).acquireAuthorizationContext(server).evidence;
    expect(changedEnvironment.digest).not.toBe(initial.digest);

    const changedLiteral = createMcpCredentialAccess(environment, kilnHome, { authorizationKey: key }).acquireAuthorizationContext(
      resolvedServer({
        env: server.env,
        headers: {
          authorization: { fromCredential: "studio-token" },
          "x-mode": { value: "changed" },
        },
      }),
    ).evidence;
    expect(changedLiteral.digest).not.toBe(initial.digest);

    access.set("studio-token", "credential-changed");
    expect(access.acquireAuthorizationContext(server).evidence.digest).not.toBe(initial.digest);

    const changedKey = createMcpCredentialAccess(environment, kilnHome, { authorizationKey: Buffer.alloc(32, 12) });
    expect(changedKey.acquireAuthorizationContext(server).evidence.digest).not.toBe(initial.digest);
  });

  it("rotates only the keyed authorization evidence for raw transport changes", () => {
    const key = Buffer.alloc(32, 13);
    const firstStdio = resolvedServer({
      transport: "stdio",
      command: "runner --token=alpha",
      args: ["--opaque-flag=first", "--mode=stable"],
      cwd: "C:\\mcp\\alpha",
      url: undefined,
      headers: undefined,
    });
    const secondStdio = resolvedServer({
      transport: "stdio",
      command: "runner --token=beta",
      args: ["--opaque-flag=second", "--mode=stable"],
      cwd: "D:\\mcp\\beta",
      url: undefined,
      headers: undefined,
    });
    const access = createMcpCredentialAccess({}, mkdtemp("kiln-mcp-auth-transport-"), { authorizationKey: key });

    expect(deriveMcpServerBindingDigest(secondStdio)).toBe(deriveMcpServerBindingDigest(firstStdio));
    expect(access.acquireAuthorizationContext(secondStdio).evidence.digest)
      .not.toBe(access.acquireAuthorizationContext(firstStdio).evidence.digest);

    const firstHttp = resolvedServer({
      url: "https://endpoint-a.example.test/mcp?sig=alpha&session=one",
      headers: undefined,
    });
    const secondHttp = resolvedServer({
      url: "https://endpoint-b.example.test/other?sig=beta&session=two",
      headers: undefined,
    });
    expect(deriveMcpServerBindingDigest(secondHttp)).toBe(deriveMcpServerBindingDigest(firstHttp));
    expect(access.acquireAuthorizationContext(secondHttp).evidence.digest)
      .not.toBe(access.acquireAuthorizationContext(firstHttp).evidence.digest);
  });

  it("binds an authorization lease to one credential and environment snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-auth-lease-"));
    roots.push(root);
    const kilnHome = join(root, ".kiln");
    const key = Buffer.alloc(32, 17);
    const environment: Record<string, string | undefined> = {
      [KILN_MCP_SECRET_KEY_ENV]: "master-key",
      MCP_REGION: "us-east-1",
    };
    const server = resolvedServer({
      env: { REGION: { fromEnv: "MCP_REGION" } },
      headers: { authorization: { fromCredential: "studio-token" } },
    });
    const access = createMcpCredentialAccess(environment, kilnHome, { authorizationKey: key });
    access.set("studio-token", "credential-initial");

    const initial = access.acquireAuthorizationContext(server);
    expect(initial.credentialResolver("studio-token")).toBe("credential-initial");
    expect(initial.environment).toEqual({ MCP_REGION: "us-east-1" });

    environment.MCP_REGION = "eu-west-1";
    access.set("studio-token", "credential-rotated");

    expect(initial.credentialResolver("studio-token")).toBe("credential-initial");
    expect(initial.environment).toEqual({ MCP_REGION: "us-east-1" });
    const rotated = access.acquireAuthorizationContext(server);
    expect(rotated.credentialResolver("studio-token")).toBe("credential-rotated");
    expect(rotated.environment).toEqual({ MCP_REGION: "eu-west-1" });
    expect(rotated.evidence.digest).not.toBe(initial.evidence.digest);
  });

  it("computes context without credential-store availability and fails closed without leaking references or values", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-auth-missing-"));
    roots.push(root);
    const secret = "missing-secret-value";
    const access = createMcpCredentialAccess({ MCP_REGION: "us-east-1" }, join(root, ".kiln"), { authorizationKey: Buffer.alloc(32, 3) });
    expect(access.available).toBe(false);
    expect(access.acquireAuthorizationContext(resolvedServer({
      env: { MODE: { value: "safe" }, REGION: { fromEnv: "MCP_REGION" } },
      headers: { "x-client": { value: "kiln" } },
    })).evidence).toMatchObject({ revision: MCP_AUTHORIZATION_CONTEXT_PROJECTION_REVISION });

    const missing = resolvedServer({ headers: { authorization: { fromCredential: secret } } });
    let error: unknown;
    try {
      access.acquireAuthorizationContext(missing);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: expect.stringContaining("unresolved environment or credential reference") });
    expect(String(error)).not.toContain(secret);

    expect(() => access.acquireAuthorizationContext(resolvedServer({
      env: { MISSING: { fromEnv: "UNAVAILABLE_ENVIRONMENT" } },
    }))).toThrow("unresolved environment or credential reference");
  });
});

function resolvedServer(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    id: "studio",
    enabled: true,
    transport: "streamable-http",
    source: "global",
    provenance: {},
    connection: { state: "not-tested" },
    projection: { state: "not-synchronized" },
    ...overrides,
  };
}

function mkdtemp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
