import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AesSecretStore } from "../../src/security/secret-store.js";
import { KilnError } from "../../src/engine/errors.js";

describe("AesSecretStore", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kiln-secret-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    storePath = join(tmpDir, "secrets.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("encrypts and decrypts a value round-trip", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("api-key", "secret-value-123");
    expect(store.get("api-key")).toBe("secret-value-123");
  });

  it("stores multiple secrets independently", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("key-a", "value-a");
    store.set("key-b", "value-b");
    store.set("key-c", "value-c");
    expect(store.get("key-a")).toBe("value-a");
    expect(store.get("key-b")).toBe("value-b");
    expect(store.get("key-c")).toBe("value-c");
  });

  it("persists secrets across instances (survives reload)", () => {
    const store1 = new AesSecretStore(storePath, "master-password");
    store1.set("persisted-key", "persisted-value");

    const store2 = new AesSecretStore(storePath, "master-password");
    expect(store2.get("persisted-key")).toBe("persisted-value");
  });

  it("rotates key and decrypts with new key after rotation", () => {
    const store = new AesSecretStore(storePath, "old-password");
    store.set("secret", "my-value");
    store.rotateKey("new-password");

    // Same instance works after rotation
    expect(store.get("secret")).toBe("my-value");

    // New instance with new password works
    const store2 = new AesSecretStore(storePath, "new-password");
    expect(store2.get("secret")).toBe("my-value");
  });

  it("throws SECRET_DECRYPTION_FAILED when loaded with wrong master key", () => {
    const store1 = new AesSecretStore(storePath, "correct-password");
    store1.set("secret", "sensitive");

    const store2 = new AesSecretStore(storePath, "wrong-password");
    expect(() => store2.get("secret")).toThrow(KilnError);

    try {
      store2.get("secret");
    } catch (err) {
      expect((err as KilnError).code).toBe("SECRET_DECRYPTION_FAILED");
    }
  });

  it("returns null for missing key", () => {
    const store = new AesSecretStore(storePath, "master-password");
    expect(store.get("nonexistent")).toBeNull();
  });

  it("has() returns true for existing key and false for missing", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("exists", "value");
    expect(store.has("exists")).toBe(true);
    expect(store.has("does-not-exist")).toBe(false);
  });

  it("delete() removes the key and returns true", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("to-delete", "value");
    expect(store.delete("to-delete")).toBe(true);
    expect(store.has("to-delete")).toBe(false);
    expect(store.get("to-delete")).toBeNull();
  });

  it("delete() returns false for nonexistent key", () => {
    const store = new AesSecretStore(storePath, "master-password");
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("keys() returns all stored key names", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("alpha", "1");
    store.set("beta", "2");
    store.set("gamma", "3");
    const keys = store.keys();
    expect(keys).toContain("alpha");
    expect(keys).toContain("beta");
    expect(keys).toContain("gamma");
    expect(keys).toHaveLength(3);
  });

  it("produces valid JSON file format with version, salt, and secrets", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("my-key", "my-value");

    const raw = readFileSync(storePath, "utf-8");
    const file = JSON.parse(raw);
    expect(file.version).toBe(1);
    expect(typeof file.salt).toBe("string");
    expect(file.secrets).toBeDefined();
    expect(file.secrets["my-key"]).toBeDefined();
    expect(typeof file.secrets["my-key"].iv).toBe("string");
    expect(typeof file.secrets["my-key"].data).toBe("string");
    expect(typeof file.secrets["my-key"].tag).toBe("string");
  });

  it("encrypts empty string correctly", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("empty", "");
    expect(store.get("empty")).toBe("");
  });

  it("encrypts unicode content correctly", () => {
    const unicode = "こんにちは 🌍 Héllo Wörld";
    const store = new AesSecretStore(storePath, "master-password");
    store.set("unicode", unicode);
    expect(store.get("unicode")).toBe(unicode);
  });

  it("encrypts large strings (10KB+) correctly", () => {
    const large = "x".repeat(10_240);
    const store = new AesSecretStore(storePath, "master-password");
    store.set("large", large);
    expect(store.get("large")).toBe(large);
  });

  it("old password fails after key rotation", () => {
    const store = new AesSecretStore(storePath, "old-password");
    store.set("secret", "value");
    store.rotateKey("new-password");

    const storeWithOldKey = new AesSecretStore(storePath, "old-password");
    expect(() => storeWithOldKey.get("secret")).toThrow(KilnError);
  });

  it("stored ciphertext is different from plaintext", () => {
    const store = new AesSecretStore(storePath, "master-password");
    store.set("key", "plaintext-value");

    const raw = readFileSync(storePath, "utf-8");
    expect(raw).not.toContain("plaintext-value");
  });
});
