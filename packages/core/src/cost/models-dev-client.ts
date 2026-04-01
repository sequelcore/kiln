import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ModelDevPricing {
  readonly inputCostPer1k: number;
  readonly outputCostPer1k: number;
  readonly cacheReadCostPer1k?: number;
  readonly cacheWriteCostPer1k?: number;
  readonly contextWindow?: number;
}

interface CacheEntry {
  readonly fetchedAt: string;
  readonly data: Record<string, ModelDevPricing>;
}

interface ApiJsonCost {
  readonly input: number;
  readonly output: number;
  readonly cache_read?: number;
  readonly cache_write?: number;
}

interface ApiJsonResponse {
  readonly [key: string]: {
    readonly cost?: ApiJsonCost;
    readonly context_length?: number;
  };
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class ModelDevClient {
  private readonly cachePath: string;
  private cache: CacheEntry | null = null;

  constructor(cacheDir: string) {
    this.cachePath = join(cacheDir, "models-cache.json");
  }

  async getPricing(provider: string, model: string): Promise<ModelDevPricing | null> {
    const data = await this.loadCache();
    if (!data) return null;

    const key1 = `${provider}/${model}`;
    const key2 = model;

    if (data[key1]) return data[key1];
    if (data[key2]) return data[key2];
    return null;
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch("https://models.dev/api.json");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = (await response.json()) as ApiJsonResponse;
      const data = this.mapApiResponse(json);
      this.cache = {
        fetchedAt: new Date().toISOString(),
        data,
      };
      await this.persistCache();
    } catch {
      await this.loadStaleCache();
    }
  }

  private mapApiResponse(json: ApiJsonResponse): Record<string, ModelDevPricing> {
    const result: Record<string, ModelDevPricing> = {};
    for (const [key, value] of Object.entries(json)) {
      const cost = value.cost;
      if (!cost) continue;
      result[key] = {
        inputCostPer1k: cost.input * 1000,
        outputCostPer1k: cost.output * 1000,
        cacheReadCostPer1k: cost.cache_read != null ? cost.cache_read * 1000 : undefined,
        cacheWriteCostPer1k: cost.cache_write != null ? cost.cache_write * 1000 : undefined,
        contextWindow: value.context_length,
      };
    }
    return result;
  }

  private async loadCache(): Promise<Record<string, ModelDevPricing> | null> {
    if (this.cache) {
      const age = Date.now() - new Date(this.cache.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) return this.cache.data;
    }
    await this.refresh();
    return this.cache?.data ?? null;
  }

  private async loadStaleCache(): Promise<void> {
    try {
      const content = await readFile(this.cachePath, "utf-8");
      this.cache = JSON.parse(content) as CacheEntry;
    } catch {
      this.cache = null;
    }
  }

  private async persistCache(): Promise<void> {
    if (!this.cache) return;
    try {
      await mkdir(new URL("file://" + this.cachePath).pathname.replace(/[/\\][^/\\]+$/, ""), {
        recursive: true,
      });
      await writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch {
      // fail-open: ignore write errors
    }
  }
}

export function createModelDevClient(cacheDir: string): ModelDevClient {
  return new ModelDevClient(cacheDir);
}
