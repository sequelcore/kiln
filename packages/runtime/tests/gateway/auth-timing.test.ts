import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireApiKey, requireBearer } from "../../src/gateway/auth-middleware.js";

// ---------------------------------------------------------------------------
// Auth middleware timing-safety tests
//
// NOTE ON TIMING ATTACKS:
// True timing attack verification requires statistical analysis over thousands
// of requests and is inherently flaky in CI environments. The timing safety of
// this middleware is verified by code inspection: auth-middleware.ts uses
// Node.js crypto.timingSafeEqual for constant-time comparison of credentials.
// The early return for different-length strings is safe because it leaks only
// length information (not content), which is not useful for a timing attack
// when the attacker already knows the expected length from the API schema.
//
// These tests focus on functional correctness of the auth middleware.
// ---------------------------------------------------------------------------

function makeApp(middleware: Parameters<Hono["use"]>[1]): Hono {
  const app = new Hono();
  app.use("*", middleware);
  app.get("/protected", (c) => c.json({ ok: true }));
  app.post("/protected", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// requireApiKey: functional correctness
// ---------------------------------------------------------------------------

describe("Auth timing safety: requireApiKey", () => {
  const API_KEY = "sk-test-key-abc123def456";
  const app = makeApp(requireApiKey(API_KEY));

  it("accepts correct API key (200)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { "X-Api-Key": API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects wrong API key of same length (401)", async () => {
    // Same length as API_KEY but different content
    const wrongKey = "sk-test-key-XXXXXXXXXXXXXX".slice(0, API_KEY.length);
    expect(wrongKey.length).toBe(API_KEY.length);

    const res = await app.request("/protected", {
      method: "GET",
      headers: { "X-Api-Key": wrongKey },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects wrong API key of different length (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { "X-Api-Key": "short" },
    });
    expect(res.status).toBe(401);

    const res2 = await app.request("/protected", {
      method: "GET",
      headers: { "X-Api-Key": API_KEY + "-extra-padding-to-make-it-longer" },
    });
    expect(res2.status).toBe(401);
  });

  it("rejects missing API key header (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unauthorized");
    expect(body.message).toContain("API key");
  });

  it("rejects empty string API key (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { "X-Api-Key": "" },
    });
    expect(res.status).toBe(401);
  });

  it("is case-sensitive for API key", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { "X-Api-Key": API_KEY.toUpperCase() },
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// requireBearer: functional correctness
// ---------------------------------------------------------------------------

describe("Auth timing safety: requireBearer", () => {
  const TOKEN = "eyJhbGciOiJIUzI1NiJ9.test-token-value";
  const app = makeApp(requireBearer(TOKEN));

  it("accepts correct Bearer token (200)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects wrong Bearer token of same length (401)", async () => {
    const wrongToken = "X".repeat(TOKEN.length);
    expect(wrongToken.length).toBe(TOKEN.length);

    const res = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects wrong Bearer token of different length (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: "Bearer short" },
    });
    expect(res.status).toBe(401);

    const res2 = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}-with-extra-data-appended` },
    });
    expect(res2.status).toBe(401);
  });

  it("rejects missing Authorization header (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("unauthorized");
    expect(body.message).toContain("Bearer");
  });

  it("rejects non-Bearer auth scheme (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects Bearer prefix without token (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("rejects token without Bearer prefix (401)", async () => {
    const res = await app.request("/protected", {
      method: "GET",
      headers: { Authorization: TOKEN },
    });
    expect(res.status).toBe(401);
  });
});
