import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KilnError } from "@kilnai/core/engine";
import type { SecretStore } from "@kilnai/core/security";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const FILE_VERSION = 1;

interface EncryptedSecret {
  readonly iv: string;
  readonly data: string;
  readonly tag: string;
}

interface StoreFile {
  readonly version: number;
  readonly salt: string;
  readonly secrets: Record<string, EncryptedSecret>;
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

function encrypt(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    data: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt(secret: EncryptedSecret, key: Buffer): string {
  const iv = Buffer.from(secret.iv, "base64");
  const data = Buffer.from(secret.data, "base64");
  const tag = Buffer.from(secret.tag, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new KilnError("SECRET_DECRYPTION_FAILED", "Failed to decrypt secret: authentication tag mismatch", {
      retryable: false,
    });
  }
}

class EncryptedSecretStore implements SecretStore {
  private masterKey: string;
  private salt: Buffer | null = null;
  private store: Record<string, EncryptedSecret> = {};

  constructor(
    private readonly storePath: string,
    masterKey: string,
  ) {
    this.masterKey = masterKey;
    mkdirSync(dirname(storePath), { recursive: true });
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.storePath)) return;
    const raw = readFileSync(this.storePath, "utf-8");
    const file = JSON.parse(raw) as StoreFile;
    this.salt = Buffer.from(file.salt, "base64");
    this.store = { ...file.secrets };
  }

  private derivedKey(): Buffer {
    if (!this.salt) this.salt = randomBytes(SALT_LENGTH);
    return deriveKey(this.masterKey, this.salt);
  }

  private persist(): void {
    const salt = this.salt;
    if (!salt) throw new Error("Encrypted secret store salt is not initialized.");
    const file: StoreFile = {
      version: FILE_VERSION,
      salt: salt.toString("base64"),
      secrets: this.store,
    };
    const tmpPath = `${this.storePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(file, null, 2), "utf-8");
    renameSync(tmpPath, this.storePath);
  }

  set(key: string, value: string): void {
    this.store[key] = encrypt(value, this.derivedKey());
    this.persist();
  }

  get(key: string): string | null {
    const secret = this.store[key];
    return secret ? decrypt(secret, this.derivedKey()) : null;
  }

  has(key: string): boolean {
    return key in this.store;
  }

  delete(key: string): boolean {
    if (!(key in this.store)) return false;
    const { [key]: _removed, ...rest } = this.store;
    this.store = rest;
    this.persist();
    return true;
  }

  keys(): readonly string[] {
    return Object.keys(this.store);
  }

  rotateKey(newMasterKey: string): void {
    const oldKey = this.derivedKey();
    const decrypted = Object.fromEntries(
      Object.entries(this.store).map(([key, value]) => [key, decrypt(value, oldKey)]),
    );

    this.masterKey = newMasterKey;
    this.salt = randomBytes(SALT_LENGTH);
    const newKey = this.derivedKey();
    this.store = Object.fromEntries(Object.entries(decrypted).map(([key, value]) => [key, encrypt(value, newKey)]));
    this.persist();
  }
}

export function createEncryptedSecretStore(storePath: string, masterKey: string): SecretStore {
  return new EncryptedSecretStore(storePath, masterKey);
}
