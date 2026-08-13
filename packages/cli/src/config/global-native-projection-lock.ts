import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const issuedTokens = new WeakSet<object>();

export interface GlobalNativeProjectionLockToken {
  readonly installStateDir: string;
}

export async function withGlobalNativeProjectionLock<T>(
  installStateDir: string,
  action: (token: GlobalNativeProjectionLockToken) => Promise<T>,
  options: { readonly timeoutMs?: number; readonly retryMs?: number } = {},
): Promise<T> {
  const normalizedDir = resolve(installStateDir);
  const lockPath = join(normalizedDir, "global-native-projections.lock");
  const ownerPath = join(lockPath, "owner.json");
  const ownerToken = randomUUID();
  const timeoutMs = bounded(options.timeoutMs, 5_000, true, "timeoutMs");
  const retryMs = bounded(options.retryMs, 25, false, "retryMs");
  const deadline = Date.now() + timeoutMs;
  mkdirSync(normalizedDir, { recursive: true, mode: 0o700 });
  while (true) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      try {
        writeFileSync(ownerPath, `${JSON.stringify({ token: ownerToken, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, {
          encoding: "utf8", flag: "wx", mode: 0o600,
        });
      } catch (error) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Global native projection lock is held at ${lockPath}; remove it only after confirming no projection operation is active.`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
    }
  }
  const token = { installStateDir: normalizedDir };
  issuedTokens.add(token);
  try {
    return await action(token);
  } finally {
    issuedTokens.delete(token);
    if (readOwnerToken(ownerPath) !== ownerToken) {
      throw new Error(`Global native projection lock ownership changed at ${lockPath}; refusing unsafe cleanup.`);
    }
    rmSync(lockPath, { recursive: true });
  }
}

function bounded(value: number | undefined, fallback: number, allowZero: boolean, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (allowZero ? resolved < 0 : resolved <= 0) || resolved > 60_000) {
    throw new TypeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} integer no greater than 60000.`);
  }
  return resolved;
}

export function runGlobalNativeProjectionTransaction<T>(
  installStateDir: string,
  token: GlobalNativeProjectionLockToken | undefined,
  action: () => Promise<T>,
): Promise<T> {
  if (token !== undefined) {
    if (!issuedTokens.has(token) || token.installStateDir !== resolve(installStateDir)) {
      throw new Error("Global native projection lock token is invalid.");
    }
    return action();
  }
  return withGlobalNativeProjectionLock(installStateDir, () => action());
}

function readOwnerToken(path: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { token?: unknown }).token === "string"
      ? (value as { token: string }).token
      : undefined;
  } catch {
    return undefined;
  }
}
