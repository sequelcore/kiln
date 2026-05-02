import { readFile } from "node:fs/promises";
import type { CredentialFileStore } from "./credential-file-store.js";

export interface CredentialMigratorConfig<TAuth> {
  readonly store: CredentialFileStore<TAuth>;
}

export interface MigrateLegacyCredentialFileOptions<TAuth> {
  readonly providerId: string;
  readonly legacyFilePath: string;
  readonly id?: string;
  readonly label?: string;
  readonly parseAuth?: (value: unknown) => TAuth;
}

export class CredentialMigrator<TAuth> {
  private readonly store: CredentialFileStore<TAuth>;

  constructor(config: CredentialMigratorConfig<TAuth>) {
    this.store = config.store;
  }

  async migrateLegacyCredentialFile(
    options: MigrateLegacyCredentialFileOptions<TAuth>,
  ): Promise<boolean> {
    const legacyContent = await readLegacyFile(options.legacyFilePath);
    if (legacyContent === null) {
      return false;
    }

    if (await this.store.hasProviderCredentials(options.providerId)) {
      throw new Error(
        `Provider '${options.providerId}' already has directory credentials; refusing to keep legacy and directory forms together`,
      );
    }

    const parsed = JSON.parse(legacyContent) as unknown;
    const auth = options.parseAuth ? options.parseAuth(parsed) : parsed as TAuth;
    const id = options.id ?? "default";

    await this.store.writeCredential({
      providerId: options.providerId,
      id,
      label: options.label ?? "Default",
      source: "imported",
      auth,
    });

    const written = await this.store.readProviderCredentials(options.providerId);
    if (!written.some((credential) => credential.id === id)) {
      throw new Error(`Credential migration for provider '${options.providerId}' could not verify '${id}'`);
    }

    await this.store.deleteFile(options.legacyFilePath);
    return true;
  }
}

async function readLegacyFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
