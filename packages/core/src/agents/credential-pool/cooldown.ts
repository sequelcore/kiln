export interface CooldownPolicy {
  readonly defaultCooldownMs: number;
  readonly maxCooldownMs?: number;
}

export const DEFAULT_COOLDOWN_POLICY: CooldownPolicy = {
  defaultCooldownMs: 60 * 60 * 1000, // 1 hour
};

export function computeCooldownUntil(
  policy: CooldownPolicy,
  serverResetAt: number | null,
): number {
  const now = Date.now();

  if (serverResetAt !== null && serverResetAt > now) {
    const serverCooldown = serverResetAt - now;
    return now + (
      policy.maxCooldownMs === undefined
        ? serverCooldown
        : Math.min(serverCooldown, policy.maxCooldownMs)
    );
  }

  return now + policy.defaultCooldownMs;
}

export function createCooldownPolicy(options?: {
  readonly defaultCooldownMs?: number;
  readonly maxCooldownMs?: number;
}): CooldownPolicy {
  return {
    defaultCooldownMs: options?.defaultCooldownMs ?? DEFAULT_COOLDOWN_POLICY.defaultCooldownMs,
    maxCooldownMs: options?.maxCooldownMs ?? DEFAULT_COOLDOWN_POLICY.maxCooldownMs,
  };
}
