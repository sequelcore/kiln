import { taskStateToolMetadata, type SessionTaskStatus } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import { optionalString, requireString, toErrorResult, toSuccessResult } from "./tool-helpers.js";

const TASK_STATUSES: readonly SessionTaskStatus[] = [
  "pending",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
];

export interface SessionTask {
  readonly id: string;
  readonly title: string;
  readonly status: SessionTaskStatus;
  readonly details?: string;
  readonly dependsOn: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface TaskStateStoreOptions {
  readonly now?: () => number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export interface TaskStateSnapshot {
  readonly tasks: readonly SessionTask[];
  readonly counts: Readonly<Record<SessionTaskStatus, number>>;
  readonly sequence: number;
}

export class TaskStateStore {
  private readonly now: () => number;
  private readonly tasks = new Map<string, SessionTask>();
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private nextId = 1;
  private sequence = 0;

  constructor(options: TaskStateStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  update(request: {
    readonly id?: string;
    readonly title: string;
    readonly status: SessionTaskStatus;
    readonly details?: string;
  readonly dependsOn?: readonly string[];
  }): SessionTask {
    const id = request.id ?? this.allocateId();
    const previous = this.tasks.get(id);
    const timestamp = new Date(this.now()).toISOString();
    this.sequence += 1;
    const task: SessionTask = {
      id,
      title: request.title,
      status: request.status,
      ...(request.details !== undefined ? { details: request.details } : {}),
      dependsOn: normalizeDependencies(request.dependsOn ?? previous?.dependsOn ?? []),
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      sequence: this.sequence,
    };
    this.tasks.set(id, task);
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/tasks");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/tasks/${id}`);
    return task;
  }

  list(status?: SessionTaskStatus): readonly SessionTask[] {
    return Array.from(this.tasks.values())
      .filter((task) => !status || task.status === status)
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  }

  snapshot(status?: SessionTaskStatus): TaskStateSnapshot {
    return {
      tasks: this.list(status),
      counts: this.counts(),
      sequence: this.sequence,
    };
  }

  get size(): number {
    return this.tasks.size;
  }

  private allocateId(): string {
    let id = `task_${this.nextId++}`;
    while (this.tasks.has(id)) {
      id = `task_${this.nextId++}`;
    }
    return id;
  }

  private counts(): Readonly<Record<SessionTaskStatus, number>> {
    const counts: Record<SessionTaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const task of this.tasks.values()) {
      counts[task.status] += 1;
    }
    return counts;
  }
}

export class TaskListTool implements DevTool {
  readonly name = "task_list";
  readonly description = TOOL_SCHEMAS.task_list.description;
  readonly inputSchema = TOOL_SCHEMAS.task_list.inputSchema;
  private readonly store: TaskStateStore;

  constructor(options: { readonly store: TaskStateStore }) {
    this.store = options.store;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const statusInput = parseStatus(input);
    if (!statusInput.ok) {
      return toErrorResult(statusInput.message, taskStateToolMetadata("task_list", {
        operation: "list",
        taskCount: 0,
        errorCode: "invalid_input",
      }));
    }
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) return verbosityInput.result;

    const snapshot = this.store.snapshot(statusInput.value);
    const metadata = taskStateToolMetadata("task_list", {
      operation: "list",
      status: statusInput.value,
      taskCount: snapshot.tasks.length,
      totalTaskCount: this.store.size,
      sequence: snapshot.sequence,
      verbosity: verbosityInput.value,
    });
    return toSuccessResult(formatTaskList(snapshot, verbosityInput.value), metadata);
  }
}

export class TaskUpdateTool implements DevTool {
  readonly name = "task_update";
  readonly description = TOOL_SCHEMAS.task_update.description;
  readonly inputSchema = TOOL_SCHEMAS.task_update.inputSchema;
  private readonly store: TaskStateStore;

  constructor(options: { readonly store: TaskStateStore }) {
    this.store = options.store;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const titleInput = requireString(input, "title");
    if (!titleInput.ok) return titleInput.result;
    const title = titleInput.value.trim();
    if (title.length === 0) {
      return toErrorResult('Invalid input: "title" must be a non-empty string');
    }
    const statusInput = parseRequiredStatus(input);
    if (!statusInput.ok) return toErrorResult(statusInput.message);
    const idInput = parseOptionalId(input);
    if (!idInput.ok) return toErrorResult(idInput.message);
    const dependsOnInput = parseDependsOn(input, idInput.value);
    if (!dependsOnInput.ok) return toErrorResult(dependsOnInput.message);
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) return verbosityInput.result;

    const task = this.store.update({
      id: idInput.value,
      title,
      status: statusInput.value,
      details: optionalString(input, "details"),
      dependsOn: dependsOnInput.value,
    });
    const snapshot = this.store.snapshot();
    const metadata = taskStateToolMetadata("task_update", {
      operation: "update",
      id: task.id,
      status: task.status,
      taskCount: snapshot.tasks.length,
      sequence: task.sequence,
      verbosity: verbosityInput.value,
    });
    return toSuccessResult(formatTaskUpdate(task, snapshot, verbosityInput.value), metadata);
  }
}

function parseStatus(input: ToolInput): { ok: true; value?: SessionTaskStatus } | { ok: false; message: string } {
  const value = input.input["status"];
  if (value === undefined || value === null || value === "all") {
    return { ok: true };
  }
  return isTaskStatus(value)
    ? { ok: true, value }
    : { ok: false, message: 'Invalid input: "status" must be one of pending, in_progress, blocked, completed, or cancelled' };
}

function parseRequiredStatus(input: ToolInput): { ok: true; value: SessionTaskStatus } | { ok: false; message: string } {
  const value = input.input["status"];
  return isTaskStatus(value)
    ? { ok: true, value }
    : { ok: false, message: 'Invalid input: "status" must be one of pending, in_progress, blocked, completed, or cancelled' };
}

function parseOptionalId(input: ToolInput): { ok: true; value?: string } | { ok: false; message: string } {
  const raw = input.input["id"];
  if (raw === undefined) {
    return { ok: true };
  }
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, message: 'Invalid input: "id" must be a non-empty string when provided' };
  }
  return { ok: true, value: raw.trim() };
}

function parseDependsOn(
  input: ToolInput,
  ownId: string | undefined,
): { ok: true; value?: readonly string[] } | { ok: false; message: string } {
  const raw = input.input["dependsOn"];
  if (raw === undefined || raw === null) {
    return { ok: true };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Invalid input: "dependsOn" must be an array of task ids' };
  }
  const dependencies: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, message: 'Invalid input: "dependsOn" must contain only non-empty strings' };
    }
    const dependency = value.trim();
    if (ownId && dependency === ownId) {
      return { ok: false, message: "Invalid input: task cannot depend on itself" };
    }
    dependencies.push(dependency);
  }
  return { ok: true, value: normalizeDependencies(dependencies) };
}

function isTaskStatus(value: unknown): value is SessionTaskStatus {
  return TASK_STATUSES.includes(value as SessionTaskStatus);
}

function normalizeDependencies(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function formatTaskUpdate(
  task: SessionTask,
  snapshot: TaskStateSnapshot,
  verbosity: "raw" | "structured" | "summary",
): string {
  if (verbosity === "structured") {
    return JSON.stringify({ task, counts: snapshot.counts, sequence: snapshot.sequence }, null, 2);
  }
  if (verbosity === "summary") {
    return `${task.id} ${task.status}; ${snapshot.tasks.length} tasks`;
  }
  return `${task.id}\t${task.status}\t${task.title}`;
}

function formatTaskList(
  snapshot: TaskStateSnapshot,
  verbosity: "raw" | "structured" | "summary",
): string {
  if (verbosity === "structured") {
    return JSON.stringify(snapshot, null, 2);
  }
  if (verbosity === "summary") {
    return `${snapshot.tasks.length} tasks; sequence ${snapshot.sequence}`;
  }
  if (snapshot.tasks.length === 0) {
    return "No tasks";
  }
  return snapshot.tasks.map((task) => `${task.id}\t${task.status}\t${task.title}`).join("\n");
}
