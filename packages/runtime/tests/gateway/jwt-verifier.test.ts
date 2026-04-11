import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JwtPayload } from "../../src/gateway/jwt-verifier.js";

// jose is mocked so tests don't make real JWKS network calls
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(),
}));

async function getJose() {
  return (await import("jose")) as {
    jwtVerify: ReturnType<typeof vi.fn>;
    createRemoteJWKSet: ReturnType<typeof vi.fn>;
  };
}

describe("buildJwtVerifier -- RS256", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("calls createRemoteJWKSet with the configured URL", async () => {
    const jose = await getJose();
    const mockJwks = Symbol("jwks");
    jose.createRemoteJWKSet.mockReturnValue(mockJwks);
    const mockPayload: JwtPayload = { sub: "user-1", iss: "https://auth.example.com" };
    jose.jwtVerify.mockResolvedValue({ payload: mockPayload });

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    const verify = await buildJwtVerifier({
      algorithm: "RS256",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
    });

    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://auth.example.com/.well-known/jwks.json"),
      expect.any(Object),
    );

    const result = await verify("fake.token.here");
    expect(result.sub).toBe("user-1");
  });

  it("passes issuer and audience to jwtVerify when configured", async () => {
    const jose = await getJose();
    jose.createRemoteJWKSet.mockReturnValue(Symbol("jwks"));
    jose.jwtVerify.mockResolvedValue({ payload: { sub: "u" } });

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    const verify = await buildJwtVerifier({
      algorithm: "RS256",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
      issuer: "https://auth.example.com",
      audience: "kiln-api",
      clockToleranceSeconds: 45,
    });

    await verify("any.token");

    const call = jose.jwtVerify.mock.calls[0] as unknown[];
    const opts = call[2] as { issuer?: string; audience?: string; clockTolerance?: number };
    expect(opts.issuer).toBe("https://auth.example.com");
    expect(opts.audience).toBe("kiln-api");
    expect(opts.clockTolerance).toBe(45);
  });

  it("uses default clock tolerance when not configured", async () => {
    const jose = await getJose();
    jose.createRemoteJWKSet.mockReturnValue(Symbol("jwks"));
    jose.jwtVerify.mockResolvedValue({ payload: { sub: "u" } });

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    const verify = await buildJwtVerifier({
      algorithm: "RS256",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
    });

    await verify("any.token");

    const call = jose.jwtVerify.mock.calls[0] as unknown[];
    const opts = call[2] as { clockTolerance?: number };
    expect(opts.clockTolerance).toBe(30);
  });

  it("propagates jose errors (expired, invalid signature) to the caller", async () => {
    const jose = await getJose();
    jose.createRemoteJWKSet.mockReturnValue(Symbol("jwks"));
    jose.jwtVerify.mockRejectedValue(new Error("JWTExpired"));

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    const verify = await buildJwtVerifier({
      algorithm: "RS256",
      jwksUri: "https://auth.example.com/.well-known/jwks.json",
    });

    await expect(verify("expired.token")).rejects.toThrow("JWTExpired");
  });
});

describe("buildJwtVerifier -- HS256", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  it("throws at startup when the secretEnv var is not set", async () => {
    delete process.env["JWT_SECRET"];

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    await expect(
      buildJwtVerifier({ algorithm: "HS256", secretEnv: "JWT_SECRET" }),
    ).rejects.toThrow(`env var "JWT_SECRET" is not set`);
  });

  it("builds a verifier when the secretEnv var is set", async () => {
    process.env["JWT_SECRET"] = "a-valid-secret-of-at-least-32-characters!";

    const jose = await getJose();
    const mockPayload: JwtPayload = { sub: "user-2" };
    jose.jwtVerify.mockResolvedValue({ payload: mockPayload });

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    const verify = await buildJwtVerifier({ algorithm: "HS256", secretEnv: "JWT_SECRET" });

    const result = await verify("some.hs256.token");
    expect(result.sub).toBe("user-2");
  });

  it("passes HS256 algorithm constraint to jwtVerify", async () => {
    process.env["JWT_SECRET"] = "a-valid-secret-of-at-least-32-characters!";

    const jose = await getJose();
    jose.jwtVerify.mockResolvedValue({ payload: { sub: "u" } });

    const { buildJwtVerifier } = await import("../../src/gateway/jwt-verifier.js");
    const verify = await buildJwtVerifier({ algorithm: "HS256", secretEnv: "JWT_SECRET" });
    await verify("any.token");

    const call = jose.jwtVerify.mock.calls[0] as unknown[];
    const opts = call[2] as { algorithms?: string[] };
    expect(opts.algorithms).toEqual(["HS256"]);
  });
});
