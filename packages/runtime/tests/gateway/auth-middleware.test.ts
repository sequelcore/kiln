import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireApiKey, requireBearer, requireWebhookSignature, requireJwt, isOriginAllowed } from "../../src/gateway/auth-middleware.js";
import { createHmac } from "node:crypto";
import type { JwtVerifyFn, JwtPayload } from "../../src/gateway/jwt-verifier.js";

function makeApp(middleware: Parameters<Hono["use"]>[1]): Hono {
  const app = new Hono();
  app.use("*", middleware);
  app.post("/test", (c) => c.json({ ok: true }));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("requireApiKey", () => {
  const app = makeApp(requireApiKey("test-key-123"));

  it("allows request with valid X-Api-Key header", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Api-Key": "test-key-123", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("rejects request with invalid key", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Api-Key": "wrong-key", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects request with missing key", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("works for GET requests too", async () => {
    const res = await app.request("/test", {
      headers: { "X-Api-Key": "test-key-123" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects key with different length (timing-safe short-circuit)", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Api-Key": "short", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects key with same length but wrong content", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "X-Api-Key": "test-key-999", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});

describe("requireBearer", () => {
  const app = makeApp(requireBearer("my-bearer-token"));

  it("allows request with valid Bearer token", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer my-bearer-token" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects request with invalid token", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects request with missing Authorization header", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("rejects request with non-Bearer auth scheme", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects token with different length (timing-safe short-circuit)", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer x" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects token with same length but wrong content", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer my-bearer-XXXXX" },
    });
    expect(res.status).toBe(401);
  });
});

describe("requireWebhookSignature", () => {
  const secret = "whsec_test_secret";

  function sign(body: string): string {
    return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  }

  const app = makeApp(requireWebhookSignature(secret, "x-hub-signature-256"));

  it("allows request with valid HMAC signature", async () => {
    const body = JSON.stringify({ event: "test" });
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("rejects request with invalid signature", async () => {
    const body = JSON.stringify({ event: "test" });
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("unauthorized");
  });

  it("rejects request with missing signature header", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("isOriginAllowed", () => {
  it("allows all when allowedOrigins is undefined", () => {
    expect(isOriginAllowed("https://evil.com")).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
  });

  it("allows all when allowedOrigins is empty", () => {
    expect(isOriginAllowed("https://evil.com", [])).toBe(true);
  });

  it("allows null origin (non-browser client)", () => {
    expect(isOriginAllowed(null, ["https://example.com"])).toBe(true);
  });

  it("allows matching origin", () => {
    expect(isOriginAllowed("https://example.com", ["https://example.com"])).toBe(true);
  });

  it("allows origin from multiple allowed", () => {
    const allowed = ["https://example.com", "https://app.example.com"];
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
  });

  it("rejects non-matching origin", () => {
    expect(isOriginAllowed("https://evil.com", ["https://example.com"])).toBe(false);
  });

  it("always allows localhost", () => {
    const allowed = ["https://example.com"];
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:8080", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost", allowed)).toBe(true);
  });

  it("always allows 127.0.0.1", () => {
    const allowed = ["https://example.com"];
    expect(isOriginAllowed("http://127.0.0.1:5173", allowed)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1", allowed)).toBe(true);
  });

  it("rejects malformed origin", () => {
    expect(isOriginAllowed("not-a-url", ["https://example.com"])).toBe(false);
  });

  it("exact match: port matters", () => {
    expect(isOriginAllowed("https://example.com:8443", ["https://example.com"])).toBe(false);
    expect(isOriginAllowed("https://example.com:8443", ["https://example.com:8443"])).toBe(true);
  });

  it("exact match: protocol matters", () => {
    expect(isOriginAllowed("http://example.com", ["https://example.com"])).toBe(false);
  });
});

describe("requireJwt", () => {
  const validPayload: JwtPayload = { sub: "user-123", iss: "https://auth.example.com" };

  const successVerifier: JwtVerifyFn = async () => validPayload;
  const failVerifier: JwtVerifyFn = async () => {
    throw new Error("JWTExpired");
  };

  function makeApp(verifier: JwtVerifyFn): Hono {
    const app = new Hono();
    app.use("*", requireJwt(verifier));
    app.get("/test", (c) => c.json({ ok: true, payload: c.get("jwtPayload") }));
    return app;
  }

  it("allows request with valid JWT Bearer token", async () => {
    const app = makeApp(successVerifier);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(res.status).toBe(200);
  });

  it("attaches decoded payload to context on success", async () => {
    const app = makeApp(successVerifier);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    const body = (await res.json()) as { payload: JwtPayload };
    expect(body.payload.sub).toBe("user-123");
  });

  it("rejects request with missing Authorization header", async () => {
    const app = makeApp(successVerifier);
    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects request with non-Bearer Authorization scheme", async () => {
    const app = makeApp(successVerifier);
    const res = await app.request("/test", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects request when verifier throws (expired or invalid token)", async () => {
    const app = makeApp(failVerifier);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer expired.jwt.token" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unauthorized");
  });

  it("does not leak internal error details in 401 response", async () => {
    const leakyVerifier: JwtVerifyFn = async () => {
      throw new Error("Internal crypto error with sensitive info");
    };
    const app = makeApp(leakyVerifier);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer any.token" },
    });
    const body = await res.text();
    expect(body).not.toContain("sensitive info");
    expect(body).not.toContain("crypto error");
  });
});
