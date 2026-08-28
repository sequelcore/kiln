import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { KilnError } from "@kilnai/core/engine";

export type OpenCodeTier = "go" | "zen";

export interface OpenCodeAuthFile {
  readonly api_key: string;
  readonly tier: OpenCodeTier;
  readonly created_at: string;
}

export interface ReadNativeOpenCodeCredentialOptions {
  readonly tier?: OpenCodeTier;
  readonly sourcePath?: string;
}

export async function readNativeOpenCodeCredential(
  options: ReadNativeOpenCodeCredentialOptions = {},
): Promise<OpenCodeAuthFile | null> {
  const sourcePath = options.sourcePath ?? resolveNativeOpenCodeAuthPath();
  const tier = options.tier ?? "go";

  let sourceContents: string;
  try {
    sourceContents = await readFile(sourcePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
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
    parsed = JSON.parse(sourceContents) as Record<string, { type: string; key?: string; access?: string }>;
  } catch {
    return null;
  }

  const entry = selectOpenCodeAuthEntry(parsed, tier);
  if (!entry || entry.type !== "api") {
    return null;
  }

  const apiKey = entry.key ?? entry.access;
  if (!apiKey || typeof apiKey !== "string" || apiKey.length === 0) {
    return null;
  }

  return {
    api_key: apiKey,
    tier,
    created_at: new Date().toISOString(),
  };
}

function resolveNativeOpenCodeAuthPath(): string {
  const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

function selectOpenCodeAuthEntry(
  parsed: Record<string, { type: string; key?: string; access?: string }>,
  tier: OpenCodeTier,
): { type: string; key?: string; access?: string } | null {
  const tierProviderId = tier === "zen" ? "opencode-zen" : "opencode-go";
  return parsed[tierProviderId] ?? parsed.opencode ?? null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
