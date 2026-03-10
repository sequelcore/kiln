import { describe, expect, it } from "vitest";
import { LocalCredentialResolver } from "../../src/gateway/local-credential-resolver.js";
import type { SecretStore } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

function makeSecretStore(data: Record<string, string> = {}): SecretStore {
  const store = new Map(Object.entries(data));
  return {
    set: (k: string, v: string) => { store.set(k, v); },
    get: (k: string) => store.get(k) ?? null,
    has: (k: string) => store.has(k),
    delete: (k: string) => store.delete(k),
    keys: () => [...store.keys()],
    rotateKey: () => {},
  };
}

describe("LocalCredentialResolver", () => {
  it("resolves JSON credential from SecretStore", async () => {
    const cred = JSON.stringify({ type: "api_key", value: "sk_test", headers: { "X-Api-Key": "sk_test" } });
    const resolver = new LocalCredentialResolver(makeSecretStore({
      "tenant:t1:integration:stripe": cred,
    }));

    const result = await resolver.resolve("t1", "stripe");
    expect(result.type).toBe("api_key");
    expect(result.value).toBe("sk_test");
    expect(result.headers).toEqual({ "X-Api-Key": "sk_test" });
  });

  it("resolves plain string as bearer token", async () => {
    const resolver = new LocalCredentialResolver(makeSecretStore({
      "tenant:t1:integration:cal": "ya29.some-token",
    }));

    const result = await resolver.resolve("t1", "cal");
    expect(result.type).toBe("bearer");
    expect(result.value).toBe("ya29.some-token");
  });

  it("throws CREDENTIAL_RESOLVE_FAILED when key not found", async () => {
    const resolver = new LocalCredentialResolver(makeSecretStore());

    const err = await resolver.resolve("t1", "missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KilnError);
    expect((err as KilnError).code).toBe("CREDENTIAL_RESOLVE_FAILED");
    expect((err as KilnError).retryable).toBe(false);
  });

  it("invalidate is a no-op", () => {
    const resolver = new LocalCredentialResolver(makeSecretStore());
    expect(() => resolver.invalidate("t1", "k")).not.toThrow();
  });
});
