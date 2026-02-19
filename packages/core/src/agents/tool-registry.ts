import type { ToolDefinition } from "./index.js";
import type { DomainConfig } from "../domain/index.js";

/** Centralized tool storage with tag-based filtering. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** Register a single tool (overwrites if same name). */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** Bulk-register tools. */
  registerMany(tools: readonly ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** Remove a tool by name. */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** Get a tool by name. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Return all registered tools. */
  all(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Return tools matching ANY of the given tags. */
  filterByTags(tags: ReadonlySet<string>): readonly ToolDefinition[] {
    return [...this.tools.values()].filter((tool) => {
      for (const tag of tool.tags) {
        if (tags.has(tag)) return true;
      }
      return false;
    });
  }

  /** Shorthand for filterByTags using a DomainConfig. */
  filterByDomain(config: Pick<DomainConfig, "toolTags">): readonly ToolDefinition[] {
    return this.filterByTags(config.toolTags);
  }

  /** Return tools with no tags (available in all domains). */
  universal(): readonly ToolDefinition[] {
    return [...this.tools.values()].filter((tool) => tool.tags.size === 0);
  }

  /** Return universal + domain-specific tools, deduplicated. */
  forDomain(config: Pick<DomainConfig, "toolTags">): readonly ToolDefinition[] {
    const seen = new Map<string, ToolDefinition>();
    for (const tool of this.universal()) {
      seen.set(tool.name, tool);
    }
    for (const tool of this.filterByDomain(config)) {
      seen.set(tool.name, tool);
    }
    return [...seen.values()];
  }

  /** Total number of registered tools. */
  get count(): number {
    return this.tools.size;
  }

  /** Remove all tools. */
  clear(): void {
    this.tools.clear();
  }
}
