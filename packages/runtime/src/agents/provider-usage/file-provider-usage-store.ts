import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createProviderUsageSnapshot, type ProviderUsageSnapshot } from "@kilnai/core";

export interface ProviderUsageStore {
  put(snapshot: ProviderUsageSnapshot): void | Promise<void>;
  get(provider: string, credentialId: string, now?: Date): ProviderUsageSnapshot | undefined | Promise<ProviderUsageSnapshot | undefined>;
  list(provider?: string, now?: Date): readonly ProviderUsageSnapshot[] | Promise<readonly ProviderUsageSnapshot[]>;
  listRetained(provider?: string): readonly ProviderUsageSnapshot[] | Promise<readonly ProviderUsageSnapshot[]>;
  remove(provider: string, credentialId: string): void | Promise<void>;
}

export interface FileProviderUsageStoreConfig { readonly rootDir: string }

export class FileProviderUsageStore implements ProviderUsageStore {
  constructor(private readonly config: FileProviderUsageStoreConfig) {}

  async put(snapshot: ProviderUsageSnapshot): Promise<void> {
    const sanitized = createProviderUsageSnapshot(snapshot);
    const current = await this.readProvider(sanitized.provider);
    const next = [...current.filter((entry) => entry.credentialId !== sanitized.credentialId), sanitized]
      .sort((a, b) => a.credentialId.localeCompare(b.credentialId));
    await this.writeProvider(sanitized.provider, next);
  }

  async get(provider: string, credentialId: string, now = new Date()): Promise<ProviderUsageSnapshot | undefined> {
    return (await this.list(provider, now)).find((entry) => entry.credentialId === credentialId);
  }

  async list(provider?: string, now = new Date()): Promise<readonly ProviderUsageSnapshot[]> {
    if (provider === undefined) return [];
    return (await this.readProvider(provider)).filter((entry) => Date.parse(entry.validUntil) > now.getTime());
  }

  async listRetained(provider?: string): Promise<readonly ProviderUsageSnapshot[]> {
    return provider === undefined ? [] : this.readProvider(provider);
  }

  async remove(provider: string, credentialId: string): Promise<void> {
    const current = await this.readProvider(provider);
    await this.writeProvider(provider, current.filter((entry) => entry.credentialId !== credentialId));
  }

  private async readProvider(provider: string): Promise<readonly ProviderUsageSnapshot[]> {
    assertSafeSegment(provider);
    try {
      const parsed = JSON.parse(await readFile(this.filePath(provider), "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry) => {
        try { return [createProviderUsageSnapshot(entry as ProviderUsageSnapshot)]; } catch { return []; }
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      return [];
    }
  }

  private async writeProvider(provider: string, snapshots: readonly ProviderUsageSnapshot[]): Promise<void> {
    const directory = join(this.config.rootDir, "provider-usage");
    await mkdir(directory, { recursive: true });
    const target = this.filePath(provider);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(snapshots, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private filePath(provider: string): string {
    assertSafeSegment(provider);
    return join(this.config.rootDir, "provider-usage", `${provider}.json`);
  }
}

function assertSafeSegment(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error("Invalid provider usage segment.");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
