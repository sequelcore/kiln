import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { KilnError } from "../../engine/errors.js";

export type OpenCodeTier = "go" | "zen";

export interface OpenCodeAuthFile {
  readonly api_key: string;
  readonly tier: OpenCodeTier;
  readonly created_at: string;
}

export interface OpenCodeAuthOptions {
  readonly tokenPath?: string;
}

const DEFAULT_TOKEN_PATH = join(homedir(), ".kiln", "auth", "opencode.json");

function getDefaultOpenCodeSourcePath(): string {
  const envConfigDir = process.env.OPENCODE_CONFIG_DIR;
  if (envConfigDir) {
    return join(envConfigDir, "auth.json");
  }

  if (process.platform === "win32") {
    return join(homedir(), "AppData", "Local", "opencode", "auth.json");
  }

  return join(homedir(), ".local", "share", "opencode", "auth.json");
}

export class OpenCodeAuth {
  private readonly tokenPath: string;

  constructor(options: OpenCodeAuthOptions = {}) {
    this.tokenPath = options.tokenPath ?? DEFAULT_TOKEN_PATH;
  }

  async saveAuthFile(file: OpenCodeAuthFile): Promise<void> {
    await mkdir(dirname(this.tokenPath), { recursive: true });
    await writeFile(this.tokenPath, JSON.stringify(file, null, 2), "utf8");
  }

  async loadAuthFile(): Promise<OpenCodeAuthFile | null> {
    try {
      const contents = await readFile(this.tokenPath, "utf8");
      return JSON.parse(contents) as OpenCodeAuthFile;
    } catch (error) {
      if (this.isEnoent(error)) {
        return null;
      }
      throw new KilnError(
        "PROVIDER_AUTH_FAILED",
        "Failed to load OpenCode auth file",
        { context: { tokenPath: this.tokenPath }, cause: error },
      );
    }
  }

  async clearAuthFile(): Promise<void> {
    try {
      await unlink(this.tokenPath);
    } catch (error) {
      if (!this.isEnoent(error)) {
        throw new KilnError(
          "PROVIDER_AUTH_FAILED",
          "Failed to clear OpenCode auth file",
          { context: { tokenPath: this.tokenPath }, cause: error },
        );
      }
    }
  }

  async hasValidCredentials(): Promise<boolean> {
    const file = await this.loadAuthFile();
    return file !== null && typeof file.api_key === "string" && file.api_key.length > 0;
  }

  async getApiKey(): Promise<string> {
    const file = await this.loadAuthFile();
    if (!file || !file.api_key || file.api_key.length === 0) {
      throw new KilnError(
        "PROVIDER_AUTH_FAILED",
        "OpenCode API key not found",
        { context: { tokenPath: this.tokenPath } },
      );
    }
    return file.api_key;
  }

  async importFromOpenCodeConfig(
    opts?: { tier?: OpenCodeTier; sourcePath?: string },
  ): Promise<OpenCodeAuthFile | null> {
    const authFile = await this.readFromOpenCodeConfig(opts);
    if (!authFile) {
      return null;
    }

    await this.saveAuthFile(authFile);
    return authFile;
  }

  async readFromOpenCodeConfig(
    opts?: { tier?: OpenCodeTier; sourcePath?: string },
  ): Promise<OpenCodeAuthFile | null> {
    const sourcePath = opts?.sourcePath ?? getDefaultOpenCodeSourcePath();
    const tier = opts?.tier ?? "go";

    let sourceContents: string;
    try {
      sourceContents = await readFile(sourcePath, "utf8");
    } catch (error) {
      if (this.isEnoent(error)) {
        return null;
      }
      throw new KilnError(
        "PROVIDER_AUTH_FAILED",
        "Failed to read OpenCode config for import",
        { context: { sourcePath }, cause: error },
      );
    }

    let parsed: Record<string, { type: string; key?: string; access?: string }>;
    try {
      parsed = JSON.parse(sourceContents);
    } catch {
      return null;
    }

    const opencodeEntry = selectOpenCodeAuthEntry(parsed, tier);
    if (!opencodeEntry) {
      return null;
    }

    if (opencodeEntry.type !== "api") {
      return null;
    }

    const apiKey = opencodeEntry.key ?? opencodeEntry.access;
    if (!apiKey || typeof apiKey !== "string" || apiKey.length === 0) {
      return null;
    }

    const authFile: OpenCodeAuthFile = {
      api_key: apiKey,
      tier,
      created_at: new Date().toISOString(),
    };

    return authFile;
  }

  private isEnoent(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  }
}

function selectOpenCodeAuthEntry(
  parsed: Record<string, { type: string; key?: string; access?: string }>,
  tier: OpenCodeTier,
): { type: string; key?: string; access?: string } | null {
  const tierProviderId = tier === "zen" ? "opencode-zen" : "opencode-go";
  const tierEntry = parsed[tierProviderId];
  if (tierEntry) {
    return tierEntry;
  }
  return parsed["opencode"] ?? null;
}
