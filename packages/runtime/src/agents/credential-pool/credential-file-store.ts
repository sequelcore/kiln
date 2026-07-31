import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CREDENTIAL_FILE_MODE, applyCredentialFileMode, type CredentialSource } from "@kilnai/core";

export interface CredentialFileStoreConfig {
  readonly rootDir: string;
}

export interface RuntimeCredentialFile<TAuth> {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly source: CredentialSource;
  readonly priority: number;
  readonly tier?: string;
  readonly auth: TAuth;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WriteRuntimeCredential<TAuth> {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly source?: CredentialSource;
  readonly priority?: number;
  readonly tier?: string;
  readonly auth: TAuth;
}

export interface CredentialFileStatus {
  readonly id: string;
  readonly label: string;
  readonly providerId: string;
  readonly source: CredentialSource;
  readonly priority: number;
  readonly tier?: string;
  readonly fileName: string;
}

export class CredentialFileStoreError extends Error {
  readonly providerId: string;
  readonly filePath: string;

  constructor(message: string, providerId: string, filePath: string, cause?: unknown) {
    super(message);
    this.name = "CredentialFileStoreError";
    this.providerId = providerId;
    this.filePath = filePath;
    this.cause = cause;
  }
}

export class CredentialFileStore<TAuth> {
  private readonly rootDir: string;

  constructor(config: CredentialFileStoreConfig) {
    this.rootDir = config.rootDir;
  }

  providerDirectory(providerId: string): string {
    assertSafeSegment(providerId, "providerId");
    return join(this.rootDir, providerId);
  }

  credentialFilePath(providerId: string, id: string): string {
    assertSafeSegment(id, "credential id");
    return join(this.providerDirectory(providerId), `${id}.json`);
  }

  async writeCredential(input: WriteRuntimeCredential<TAuth>): Promise<RuntimeCredentialFile<TAuth>> {
    assertSafeSegment(input.providerId, "providerId");
    assertSafeSegment(input.id, "credential id");
    const now = new Date().toISOString();
    const filePath = this.credentialFilePath(input.providerId, input.id);
    const credential: RuntimeCredentialFile<TAuth> = {
      id: input.id,
      label: input.label,
      providerId: input.providerId,
      source: input.source ?? "manual",
      priority: input.priority ?? 0,
      tier: input.tier,
      auth: input.auth,
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(this.providerDirectory(input.providerId), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(credential, null, 2)}\n`, {
      encoding: "utf8",
      mode: CREDENTIAL_FILE_MODE,
    });
    // Every provider on this store inherits the owner-only invariant, including
    // credentials written before it existed, which repair on their next write.
    await applyCredentialFileMode(filePath);
    return credential;
  }

  async readProviderCredentials(providerId: string): Promise<readonly RuntimeCredentialFile<TAuth>[]> {
    const files = await this.listCredentialFileNames(providerId);
    const credentials: RuntimeCredentialFile<TAuth>[] = [];

    for (const fileName of files) {
      const filePath = join(this.providerDirectory(providerId), fileName);
      credentials.push(await this.readCredentialFile(providerId, filePath));
    }

    return credentials.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  async readProviderCredentialStatus(providerId: string): Promise<readonly CredentialFileStatus[]> {
    const credentials = await this.readProviderCredentials(providerId);
    return credentials.map((credential) => ({
      id: credential.id,
      label: credential.label,
      providerId: credential.providerId,
      source: credential.source,
      priority: credential.priority,
      tier: credential.tier,
      fileName: `${credential.id}.json`,
    }));
  }

  async hasProviderCredentials(providerId: string): Promise<boolean> {
    return (await this.listCredentialFileNames(providerId)).length > 0;
  }

  async deleteFile(filePath: string): Promise<void> {
    await unlink(filePath);
  }

  private async listCredentialFileNames(providerId: string): Promise<string[]> {
    assertSafeSegment(providerId, "providerId");
    try {
      const entries = await readdir(this.providerDirectory(providerId), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async readCredentialFile(
    providerId: string,
    filePath: string,
  ): Promise<RuntimeCredentialFile<TAuth>> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      return parseRuntimeCredentialFile<TAuth>(parsed, providerId, filePath);
    } catch (error) {
      if (error instanceof CredentialFileStoreError) {
        throw error;
      }
      throw new CredentialFileStoreError(
        `Malformed credential file for provider '${providerId}': ${filePath}`,
        providerId,
        filePath,
        error,
      );
    }
  }
}

function parseRuntimeCredentialFile<TAuth>(
  value: unknown,
  providerId: string,
  filePath: string,
): RuntimeCredentialFile<TAuth> {
  if (!isRecord(value)) {
    throw new CredentialFileStoreError(
      `Credential file for provider '${providerId}' must contain an object: ${filePath}`,
      providerId,
      filePath,
    );
  }

  const id = readString(value, "id", providerId, filePath);
  const label = readString(value, "label", providerId, filePath);
  const fileProviderId = readString(value, "providerId", providerId, filePath);
  const source = readCredentialSource(value.source, providerId, filePath);
  const priority = readNumber(value.priority, "priority", providerId, filePath);
  const auth = value.auth;
  if (auth === undefined) {
    throw new CredentialFileStoreError(
      `Credential file for provider '${providerId}' is missing auth: ${filePath}`,
      providerId,
      filePath,
    );
  }
  if (fileProviderId !== providerId) {
    throw new CredentialFileStoreError(
      `Credential file provider '${fileProviderId}' does not match '${providerId}': ${filePath}`,
      providerId,
      filePath,
    );
  }

  return {
    id,
    label,
    providerId: fileProviderId,
    source,
    priority,
    tier: typeof value.tier === "string" ? value.tier : undefined,
    auth: auth as TAuth,
    createdAt: readString(value, "createdAt", providerId, filePath),
    updatedAt: readString(value, "updatedAt", providerId, filePath),
  };
}

function readString(
  value: Record<string, unknown>,
  key: string,
  providerId: string,
  filePath: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new CredentialFileStoreError(
      `Credential file for provider '${providerId}' has invalid '${key}': ${filePath}`,
      providerId,
      filePath,
    );
  }
  return field;
}

function readNumber(
  value: unknown,
  key: string,
  providerId: string,
  filePath: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CredentialFileStoreError(
      `Credential file for provider '${providerId}' has invalid '${key}': ${filePath}`,
      providerId,
      filePath,
    );
  }
  return value;
}

function readCredentialSource(
  value: unknown,
  providerId: string,
  filePath: string,
): CredentialSource {
  if (value === "manual" || value === "env" || value === "imported") {
    return value;
  }
  throw new CredentialFileStoreError(
    `Credential file for provider '${providerId}' has invalid 'source': ${filePath}`,
    providerId,
    filePath,
  );
}

function assertSafeSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error(`Invalid ${label}: '${value}'`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
