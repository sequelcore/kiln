import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KilnError } from "@kilnai/core/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEncryptedSecretStore } from "../../src/credentials/encrypted-secret-store.js";

describe("createEncryptedSecretStore", () => {
  let temporaryDirectory: string;
  let storePath: string;

  beforeEach(() => {
    temporaryDirectory = join(tmpdir(), `kiln-secret-store-${randomBytes(8).toString("hex")}`);
    mkdirSync(temporaryDirectory, { recursive: true });
    storePath = join(temporaryDirectory, "secrets.json");
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("persists encrypted values with the existing versioned format", () => {
    const store = createEncryptedSecretStore(storePath, "master-password");
    store.set("api-key", "secret-value-123");

    const serialized = readFileSync(storePath, "utf8");
    const file: unknown = JSON.parse(serialized);
    expect(file).toMatchObject({
      version: 1,
      salt: expect.any(String),
      secrets: {
        "api-key": {
          iv: expect.any(String),
          data: expect.any(String),
          tag: expect.any(String),
        },
      },
    });
    expect(serialized).not.toContain("secret-value-123");
    expect(existsSync(`${storePath}.tmp`)).toBe(false);
  });

  it("preserves values, ordering, deletion, and reload behavior", () => {
    const store = createEncryptedSecretStore(storePath, "master-password");
    store.set("alpha", "one");
    store.set("beta", "two");
    store.set("unicode", "こんにちは 🌍 Héllo Wörld");
    store.set("empty", "");
    store.set("large", "x".repeat(10_240));

    expect(store.keys()).toEqual(["alpha", "beta", "unicode", "empty", "large"]);
    expect(store.get("missing")).toBeNull();
    expect(store.has("beta")).toBe(true);
    expect(store.delete("missing")).toBe(false);
    expect(store.delete("beta")).toBe(true);

    const reloaded = createEncryptedSecretStore(storePath, "master-password");
    expect(reloaded.keys()).toEqual(["alpha", "unicode", "empty", "large"]);
    expect(reloaded.get("alpha")).toBe("one");
    expect(reloaded.get("unicode")).toBe("こんにちは 🌍 Héllo Wörld");
    expect(reloaded.get("empty")).toBe("");
    expect(reloaded.get("large")).toBe("x".repeat(10_240));
  });

  it("rotates the key without changing stored values", () => {
    const store = createEncryptedSecretStore(storePath, "old-password");
    store.set("secret", "value");
    store.rotateKey("new-password");

    expect(store.get("secret")).toBe("value");
    expect(createEncryptedSecretStore(storePath, "new-password").get("secret")).toBe("value");
    expect(() => createEncryptedSecretStore(storePath, "old-password").get("secret")).toThrow(KilnError);
  });

  it("reports the canonical error when authentication fails", () => {
    const store = createEncryptedSecretStore(storePath, "correct-password");
    store.set("secret", "sensitive");
    const wrongKeyStore = createEncryptedSecretStore(storePath, "wrong-password");

    try {
      wrongKeyStore.get("secret");
      expect.fail("Expected decryption to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(KilnError);
      if (!(error instanceof KilnError)) throw error;
      expect(error.code).toBe("SECRET_DECRYPTION_FAILED");
    }
  });

  it("creates missing parent directories", () => {
    const nestedPath = join(temporaryDirectory, "deep", "nested", "secrets.json");
    const store = createEncryptedSecretStore(nestedPath, "master-password");
    store.set("key", "value");
    expect(existsSync(nestedPath)).toBe(true);
  });
});
