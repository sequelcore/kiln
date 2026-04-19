import type { ModeBSession } from "../mode-b-session.js";
import type { SessionStore } from "./session-store.js";
import { serializeSession, deserializeSession } from "./session-serializer.js";

const KEY_PREFIX = "kiln:session:";

/** Minimal interface matching ioredis -- allows any Redis client that supports these methods */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export class RedisSessionStore implements SessionStore {
  private readonly redis: RedisLike;
  private readonly defaultTtlMs: number;

  constructor(redis: RedisLike, defaultTtlMs: number = 30 * 60 * 1000) {
    this.redis = redis;
    this.defaultTtlMs = defaultTtlMs;
  }

  async get(key: string): Promise<ModeBSession | undefined> {
    const json = await this.redis.get(KEY_PREFIX + key);
    if (!json) return undefined;
    return deserializeSession(json);
  }

  async set(key: string, session: ModeBSession): Promise<void> {
    const ttlSeconds = Math.ceil((session.idleTimeoutMs ?? this.defaultTtlMs) / 1000);
    await this.redis.setex(KEY_PREFIX + key, ttlSeconds, serializeSession(session));
  }

  async delete(key: string): Promise<boolean> {
    const count = await this.redis.del(KEY_PREFIX + key);
    return count > 0;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const pattern = KEY_PREFIX + prefix + "*";
    const keys = await this.redis.keys(pattern);
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  async keys(): Promise<string[]> {
    const allKeys = await this.redis.keys(KEY_PREFIX + "*");
    return allKeys.map((k) => k.slice(KEY_PREFIX.length));
  }
}

/** Create a RedisSessionStore with a real ioredis client (dynamic import) */
export async function createRedisSessionStore(
  url: string,
  defaultTtlMs?: number,
): Promise<RedisSessionStore> {
  // Dynamic import -- ioredis is an optional peer dependency
  const moduleName = "ioredis";
  const { default: Redis } = (await import(/* @vite-ignore */ moduleName)) as {
    default: new (url: string) => RedisLike;
  };
  const redis = new Redis(url);
  return new RedisSessionStore(redis, defaultTtlMs);
}
