import { Hono } from "hono";
import {
  GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH,
  GuiMemoryLatticeGraphResponseSchema,
  type GuiMemoryLatticeError,
  type GuiMemoryLatticeScope,
} from "@kilnai/gateway-contracts";

interface RuntimeResourceContent {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
  readonly _meta?: Record<string, unknown>;
}

interface RuntimeResourceReadResult {
  readonly contents: readonly RuntimeResourceContent[];
}

export interface GuiMemoryLatticeResourceReader {
  readResource(uri: string): Promise<RuntimeResourceReadResult>;
}

export interface GuiMemoryLatticeRoutesOptions {
  readonly resources: GuiMemoryLatticeResourceReader;
  readonly defaultScope?: GuiMemoryLatticeScope;
}

const MEMORY_GRAPH_QUERY_KEYS = [
  "scope",
  "scopeKind",
  "scopeId",
  "layer",
  "query",
  "depth",
  "limit",
] as const;

const MEMORY_GRAPH_QUERY_KEY_SET = new Set<string>(MEMORY_GRAPH_QUERY_KEYS);

export function createGuiMemoryLatticeRoutes(options: GuiMemoryLatticeRoutesOptions): Hono {
  const app = new Hono();

  app.get("/memory/graph", async (c) => {
    const resourceUri = buildMemoryGraphResourceUri(new URL(c.req.url).searchParams, options.defaultScope);
    if (typeof resourceUri !== "string") {
      return c.json(resourceUri, 400);
    }

    try {
      const result = await options.resources.readResource(resourceUri);
      const response = GuiMemoryLatticeGraphResponseSchema.parse(readJsonResource(result));
      return c.json(response);
    } catch {
      return c.json({
        code: "memory_lattice_unavailable",
        message: "Memory Lattice graph is not available through the runtime resource plane.",
      } satisfies GuiMemoryLatticeError, 404);
    }
  });

  return app;
}

function buildMemoryGraphResourceUri(
  query: URLSearchParams,
  defaultScope: GuiMemoryLatticeScope | undefined,
): string | GuiMemoryLatticeError {
  for (const key of query.keys()) {
    if (!MEMORY_GRAPH_QUERY_KEY_SET.has(key)) {
      return {
        code: "invalid_memory_lattice_request",
        message: `Unsupported Memory Lattice query parameter: ${key}`,
      };
    }
  }

  const searchQuery = query.get("query")?.trim();
  if (searchQuery && searchQuery.length > GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH) {
    return {
      code: "invalid_memory_lattice_request",
      message: `Memory Lattice query must be ${GUI_MEMORY_LATTICE_QUERY_MAX_LENGTH} characters or fewer.`,
    };
  }

  const resourceQuery = new URLSearchParams();
  const hasExplicitScope = Boolean(query.get("scope")?.trim())
    || Boolean(query.get("scopeKind")?.trim())
    || Boolean(query.get("scopeId")?.trim());
  if (!hasExplicitScope && defaultScope) {
    resourceQuery.set("scopeKind", defaultScope.kind);
    resourceQuery.set("scopeId", defaultScope.id);
  }
  for (const key of MEMORY_GRAPH_QUERY_KEYS) {
    const value = query.get(key)?.trim();
    if (value) {
      resourceQuery.set(key, value);
    }
  }

  const suffix = resourceQuery.toString();
  return suffix ? `kiln://memory/graph?${suffix}` : "kiln://memory/graph";
}

function readJsonResource(result: RuntimeResourceReadResult): unknown {
  const content = result.contents.find((candidate) => typeof candidate.text === "string");
  if (!content || typeof content.text !== "string") {
    throw new Error("Memory Lattice resource did not include JSON text.");
  }
  return JSON.parse(content.text);
}
