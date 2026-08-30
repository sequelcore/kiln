import { describe, expect, it, vi } from "vitest";
import { createNativeWebFetchClient } from "../../src/web/native-web-fetch-client.js";

describe("createNativeWebFetchClient", () => {
  it("follows manual redirects and reports the exact response provenance", async () => {
    const fetchImpl = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/final" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("complete", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      );
    const client = createNativeWebFetchClient({ fetchImpl });

    await expect(
      client({
        url: "https://example.com/start",
        timeoutMs: 1_000,
        maxBytes: 1_000,
      }),
    ).resolves.toEqual({
      url: "https://example.com/final",
      status: 200,
      contentType: "text/plain",
      body: "complete",
      bytesRead: 8,
      redirectChain: ["https://example.com/start", "https://example.com/final"],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.com/start",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.com/final",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
  });

  it("caps returned body bytes while preserving the observed byte count", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("123456789", { status: 200 }));
    const client = createNativeWebFetchClient({ fetchImpl });

    await expect(
      client({
        url: "https://example.com/large",
        timeoutMs: 1_000,
        maxBytes: 4,
      }),
    ).resolves.toMatchObject({
      body: "1234",
      bytesRead: 9,
    });
  });

  it("aborts a native request at the configured timeout", async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
        }),
    );
    const client = createNativeWebFetchClient({ fetchImpl });

    await expect(
      client({
        url: "https://example.com/slow",
        timeoutMs: 5,
        maxBytes: 1_000,
      }),
    ).rejects.toThrow("request aborted");
  });

  it("stops after the admitted redirect limit", async () => {
    const fetchImpl = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "/again" } }));
    const client = createNativeWebFetchClient({ fetchImpl });

    await expect(
      client({
        url: "https://example.com/start",
        timeoutMs: 1_000,
        maxBytes: 1_000,
      }),
    ).rejects.toThrow("Too many redirects after 5 hops");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
