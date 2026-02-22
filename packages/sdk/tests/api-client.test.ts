import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiClient } from "../src/api-client.js";

describe("ApiClient", () => {
  const client = new ApiClient("http://localhost:4000");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("get returns parsed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "test" }),
    }));

    const result = await client.get<{ data: string }>("/test");
    expect(result.data).toBe("test");
    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/test");
  });

  it("get throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    await expect(client.get("/test")).rejects.toThrow("GET /test failed: 404 Not Found");
  });

  it("post sends JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "1" }),
    }));

    await client.post("/items", { name: "test" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
  });

  it("delete sends DELETE request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await client.delete("/items/1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:4000/items/1", { method: "DELETE" });
  });
});
