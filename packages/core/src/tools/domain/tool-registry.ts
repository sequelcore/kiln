// Engine domain: developer tool registry for Phase 9a (native runtime)

import type { DevTool } from './tool.js';

export class DevToolRegistry {
  private readonly _tools: Map<string, DevTool> = new Map();

  register(tool: DevTool): void {
    if (this._tools.has(tool.name)) {
      throw new Error(`DevTool already registered: ${tool.name}`);
    }

    this._tools.set(tool.name, tool);
  }

  lookup(name: string): DevTool | undefined {
    return this._tools.get(name);
  }

  list(): readonly DevTool[] {
    return Array.from(this._tools.values());
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  get size(): number {
    return this._tools.size;
  }
}
