import { KilnError } from "../../engine/errors.js";
import type { ToolCatalogIndex } from "./tool-catalog.js";
import type { MonitorRegistry } from "../infrastructure/monitor-tools.js";
import type { TaskStateStore } from "../infrastructure/task-state-tools.js";

const JSON_MIME_TYPE = "application/json";

export interface ToolResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export interface ToolResourceTemplateDescriptor {
  readonly uriTemplate: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export type ToolResourceContent =
  | {
    readonly uri: string;
    readonly mimeType?: string;
    readonly text: string;
    readonly _meta?: Record<string, unknown>;
  }
  | {
    readonly uri: string;
    readonly mimeType?: string;
    readonly blob: string;
    readonly _meta?: Record<string, unknown>;
  };

export interface ToolResourceReadResult {
  readonly contents: readonly ToolResourceContent[];
}

export interface ToolResourceRegistryOptions {
  readonly catalog: ToolCatalogIndex;
  readonly taskStateStore: TaskStateStore;
  readonly monitorRegistry: MonitorRegistry;
}

export class ToolResourceRegistry {
  private readonly catalog: ToolCatalogIndex;
  private readonly taskStateStore: TaskStateStore;
  private readonly monitorRegistry: MonitorRegistry;

  constructor(options: ToolResourceRegistryOptions) {
    this.catalog = options.catalog;
    this.taskStateStore = options.taskStateStore;
    this.monitorRegistry = options.monitorRegistry;
  }

  list(): readonly ToolResourceDescriptor[] {
    return [
      {
        uri: "kiln://tools/catalog",
        name: "tool_catalog",
        title: "Tool Catalog",
        description: "Read-only snapshot of shared Kiln builtin tool catalog entries.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uri: "kiln://session/tasks",
        name: "session_tasks",
        title: "Session Tasks",
        description: "Read-only snapshot of session-local model-visible task state.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uri: "kiln://session/monitors",
        name: "session_monitors",
        title: "Session Monitors",
        description: "Read-only snapshot of session-local monitor lifecycle state.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
    ];
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    return [
      {
        uriTemplate: "kiln://tools/catalog/{name}",
        name: "tool_catalog_entry",
        title: "Tool Catalog Entry",
        description: "Read one shared Kiln tool catalog entry by exact tool name.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://session/tasks/{id}",
        name: "session_task",
        title: "Session Task",
        description: "Read one session-local task by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://session/monitors/{id}",
        name: "session_monitor",
        title: "Session Monitor",
        description: "Read one session-local monitor snapshot and its bounded events by id.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
    ];
  }

  async read(uri: string): Promise<ToolResourceReadResult> {
    const parsed = parseKilnResourceUri(uri);
    if (!parsed) {
      throw resourceNotFound(uri);
    }

    if (parsed.host === "tools" && parsed.path.length === 1 && parsed.path[0] === "catalog") {
      const entries = this.catalog.list();
      return jsonResource(uri, {
        totalIndexed: entries.length,
        entries,
      });
    }

    if (parsed.host === "tools" && parsed.path.length === 2 && parsed.path[0] === "catalog") {
      const name = parsed.path[1] ?? "";
      const entry = this.catalog.search({ exact: name, includeSchemas: true }).entries[0];
      if (!entry) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, entry);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "tasks") {
      return jsonResource(uri, this.taskStateStore.snapshot());
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "tasks") {
      const id = parsed.path[1] ?? "";
      const task = this.taskStateStore.list().find((candidate) => candidate.id === id);
      if (!task) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, task);
    }

    if (parsed.host === "session" && parsed.path.length === 1 && parsed.path[0] === "monitors") {
      return jsonResource(uri, {
        monitors: this.monitorRegistry.list(),
      });
    }

    if (parsed.host === "session" && parsed.path.length === 2 && parsed.path[0] === "monitors") {
      const id = parsed.path[1] ?? "";
      const result = this.monitorRegistry.read(id, { limit: 1_000 });
      if (!result.snapshot) {
        throw resourceNotFound(uri);
      }
      return jsonResource(uri, {
        snapshot: result.snapshot,
        events: result.events,
      });
    }

    throw resourceNotFound(uri);
  }
}

function jsonResource(uri: string, value: unknown): ToolResourceReadResult {
  return {
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function parseKilnResourceUri(uri: string): { readonly host: string; readonly path: readonly string[] } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname.length === 0) {
    return undefined;
  }
  const path = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  return {
    host: parsed.hostname,
    path,
  };
}

function resourceNotFound(uri: string): KilnError {
  return new KilnError("INTERNAL_ERROR", `Resource not found: ${uri}`, {
    context: { uri },
    retryable: false,
  });
}
