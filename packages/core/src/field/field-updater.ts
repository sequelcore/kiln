import type { EventBus } from "../events/event-bus.js";
import type {
  ToolResultEvent,
  MemoryRecalledEvent,
  TaskCompletedEvent,
  AgentRoutedEvent,
} from "../events/index.js";
import type { FieldSignal, FieldSignalSource } from "./domain/field.js";
import type { FieldStore } from "./domain/field-store.js";

interface FieldUpdaterOptions {
  readonly eventBus: EventBus;
  readonly fieldStore: FieldStore;
}

const TOOL_SIGNAL_DELTA = 0.2;
const MEMORY_SIGNAL_DELTA = 0.1;
const TASK_SIGNAL_DELTA = 0.15;
const ROUTING_SIGNAL_DELTA = 0.12;

export class FieldUpdater {
  private readonly subscriptions: Array<() => void> = [];

  constructor(private readonly opts: FieldUpdaterOptions) {
    this.subscriptions.push(this.listenToolResults());
    this.subscriptions.push(this.listenMemory());
    this.subscriptions.push(this.listenTasks());
    this.subscriptions.push(this.listenRouting());
  }

  dispose(): void {
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions.length = 0;
  }

  private listenToolResults(): () => void {
    const handler = (event: ToolResultEvent): void => {
      this.emitSignal(
        `tool:${event.toolName}`,
        TOOL_SIGNAL_DELTA,
        "event",
        event.success ? 1 : 0.4,
        event.timestamp.getTime(),
      );
      this.emitSignal("category:tool", TOOL_SIGNAL_DELTA * 0.5, "event", 1, event.timestamp.getTime());
    };
    this.opts.eventBus.on("tool_result", handler);
    return () => this.opts.eventBus.off("tool_result", handler);
  }

  private listenMemory(): () => void {
    const handler = (event: MemoryRecalledEvent): void => {
      this.emitSignal(
        `memory:${event.query}`,
        MEMORY_SIGNAL_DELTA,
        "event",
        undefined,
        event.timestamp.getTime(),
      );
      this.emitSignal("category:memory", MEMORY_SIGNAL_DELTA * 0.5, "event", 1, event.timestamp.getTime());
    };
    this.opts.eventBus.on("memory_recalled", handler);
    return () => this.opts.eventBus.off("memory_recalled", handler);
  }

  private listenTasks(): () => void {
    const handler = (event: TaskCompletedEvent): void => {
      this.emitSignal(
        `task:${event.taskId}`,
        TASK_SIGNAL_DELTA,
        "event",
        1,
        event.timestamp.getTime(),
      );
      this.emitSignal("category:task", TASK_SIGNAL_DELTA * 0.5, "event", 1, event.timestamp.getTime());
    };
    this.opts.eventBus.on("task_completed", handler);
    return () => this.opts.eventBus.off("task_completed", handler);
  }

  private listenRouting(): () => void {
    const handler = (event: AgentRoutedEvent): void => {
      this.emitSignal(
        `agent:${event.agentId}`,
        ROUTING_SIGNAL_DELTA,
        "event",
        1,
        event.timestamp.getTime(),
      );
      this.emitSignal("category:agent", ROUTING_SIGNAL_DELTA * 0.5, "event", 1, event.timestamp.getTime());
    };
    this.opts.eventBus.on("agent_routed", handler);
    return () => this.opts.eventBus.off("agent_routed", handler);
  }

  private emitSignal(
    regionId: string,
    delta: number,
    source: FieldSignalSource,
    confidence?: number,
    timestamp?: number,
  ): void {
    const signal: FieldSignal = {
      regionId,
      delta,
      source,
      confidence,
      timestamp,
    };
    void this.opts.fieldStore.inject(signal);
  }
}
