import { monitorToolMetadata, type MonitorStatus } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import type { CommandProcessRunner } from "./command-process.js";
import {
  getSandboxContext,
  optionalNumber,
  optionalString,
  requireString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateCommand,
  validateReadPath,
} from "./tool-helpers.js";

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60_000;
const DEFAULT_READ_LIMIT = 100;
const MAX_READ_LIMIT = 1_000;
const MAX_EVENT_TEXT_BYTES = 64 * 1024;

export interface MonitorCommandRequest {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface MonitorFinishResult {
  readonly exitCode?: number | string;
  readonly signal?: NodeJS.Signals | string;
  readonly error?: Error;
  readonly timedOut?: boolean;
}

export interface MonitorOutputSink {
  stdout(text: string): void;
  stderr(text: string): void;
  finish(result: MonitorFinishResult): void;
}

export interface MonitorProcessHandle {
  readonly pid?: number;
  stop(reason: string): Promise<void>;
}

export interface MonitorCommandRunner {
  start(request: MonitorCommandRequest, sink: MonitorOutputSink): MonitorProcessHandle;
}

export interface MonitorRegistryOptions {
  readonly commandRunner?: MonitorCommandRunner;
  readonly now?: () => number;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export interface MonitorEvent {
  readonly sequence: number;
  readonly timestamp: string;
  readonly stream: "stdout" | "stderr" | "lifecycle";
  readonly text: string;
  readonly truncated?: boolean;
}

export interface MonitorSnapshot {
  readonly id: string;
  readonly name?: string;
  readonly command: string;
  readonly cwd: string;
  readonly status: MonitorStatus;
  readonly timeoutMs: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly pid?: number;
  readonly sequence: number;
  readonly exitCode?: number | string;
  readonly signal?: NodeJS.Signals | string;
  readonly timedOut?: boolean;
  readonly truncated?: boolean;
}

interface MonitorRecord {
  readonly id: string;
  readonly name?: string;
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly startedAtMs: number;
  readonly events: MonitorEvent[];
  status: MonitorStatus;
  pid?: number;
  completedAtMs?: number;
  exitCode?: number | string;
  signal?: NodeJS.Signals | string;
  timedOut?: boolean;
  truncated?: boolean;
  stopRequested?: boolean;
  handle?: MonitorProcessHandle;
  timeout?: ReturnType<typeof setTimeout>;
}

export class MonitorRegistry {
  private readonly commandRunner: MonitorCommandRunner;
  private readonly now: () => number;
  private readonly monitors = new Map<string, MonitorRecord>();
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private nextId = 1;

  constructor(options: MonitorRegistryOptions = {}) {
    this.commandRunner = options.commandRunner ?? unavailableMonitorCommandRunner;
    this.now = options.now ?? Date.now;
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  start(request: {
    readonly command: string;
    readonly cwd: string;
    readonly name?: string;
    readonly timeoutMs: number;
  }): MonitorSnapshot {
    const id = `mon_${this.nextId++}`;
    const record: MonitorRecord = {
      id,
      name: request.name,
      command: request.command,
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      startedAtMs: this.now(),
      events: [],
      status: "running",
    };
    this.monitors.set(id, record);

    const sink: MonitorOutputSink = {
      stdout: (text) => this.append(record, "stdout", text),
      stderr: (text) => this.append(record, "stderr", text),
      finish: (result) => this.finish(record, result),
    };

    try {
      const handle = this.commandRunner.start({
        id,
        command: request.command,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
      }, sink);
      record.handle = handle;
      record.pid = handle.pid;
      if (record.status === "running") {
        record.timeout = setTimeout(() => {
          record.timedOut = true;
          void this.stop(id, "timeout");
        }, request.timeoutMs);
      }
    } catch (error) {
      this.finish(record, { error: error instanceof Error ? error : new Error(String(error)) });
    }

    this.notifyMonitorChanged(record.id);
    return snapshot(record);
  }

  read(
    id: string,
    options: { readonly sinceSequence?: number; readonly limit?: number } = {},
  ): { readonly snapshot?: MonitorSnapshot; readonly events: readonly MonitorEvent[] } {
    const record = this.monitors.get(id);
    if (!record) {
      return { events: [] };
    }
    const sinceSequence = options.sinceSequence ?? 0;
    const limit = clampReadLimit(options.limit);
    const events = record.events
      .filter((event) => event.sequence > sinceSequence)
      .slice(0, limit);
    return { snapshot: snapshot(record), events };
  }

  async stop(id: string, reason: string): Promise<MonitorSnapshot | undefined> {
    const record = this.monitors.get(id);
    if (!record) {
      return undefined;
    }
    if (record.status !== "running") {
      return snapshot(record);
    }

    record.stopRequested = true;
    await record.handle?.stop(reason);
    if (record.status === "running") {
      this.finish(record, { signal: "SIGTERM" });
    }
    return snapshot(record);
  }

  list(status?: MonitorStatus): readonly MonitorSnapshot[] {
    return Array.from(this.monitors.values())
      .filter((record) => !status || record.status === status)
      .map((record) => snapshot(record));
  }

  async stopAll(reason: string): Promise<readonly MonitorSnapshot[]> {
    const running = Array.from(this.monitors.values()).filter((record) => record.status === "running");
    const snapshots: MonitorSnapshot[] = [];
    for (const record of running) {
      const stopped = await this.stop(record.id, reason);
      if (stopped) {
        snapshots.push(stopped);
      }
    }
    return snapshots;
  }

  private append(record: MonitorRecord, stream: MonitorEvent["stream"], text: string): void {
    if (text.length === 0) {
      return;
    }
    const bytes = Buffer.byteLength(text, "utf8");
    const truncated = bytes > MAX_EVENT_TEXT_BYTES;
    const boundedText = truncated
      ? Buffer.from(text, "utf8").subarray(0, MAX_EVENT_TEXT_BYTES).toString("utf8")
      : text;
    record.truncated = record.truncated || truncated;
    record.events.push({
      sequence: record.events.length + 1,
      timestamp: new Date(this.now()).toISOString(),
      stream,
      text: boundedText,
      ...(truncated ? { truncated: true } : {}),
    });
    this.notifyMonitorChanged(record.id);
  }

  private finish(record: MonitorRecord, result: MonitorFinishResult): void {
    if (record.status !== "running") {
      return;
    }
    if (record.timeout) {
      clearTimeout(record.timeout);
      record.timeout = undefined;
    }
    record.completedAtMs = this.now();
    record.exitCode = result.exitCode;
    record.signal = result.signal;
    record.timedOut = record.timedOut || result.timedOut;
    if (record.stopRequested || record.timedOut) {
      record.status = "stopped";
    } else if (result.error || result.exitCode !== undefined && result.exitCode !== 0) {
      record.status = "failed";
    } else {
      record.status = "exited";
    }
    const reason = result.error?.message ?? `status=${record.status}`;
    this.append(record, "lifecycle", `monitor finished: ${reason}\n`);
  }

  private notifyMonitorChanged(id: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/monitors");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/monitors/${id}`);
  }
}

export class MonitorStartTool implements DevTool {
  readonly name = "monitor_start";
  readonly description = TOOL_SCHEMAS.monitor_start.description;
  readonly inputSchema = TOOL_SCHEMAS.monitor_start.inputSchema;
  private readonly registry: MonitorRegistry;

  constructor(options: { readonly registry: MonitorRegistry }) {
    this.registry = options.registry;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const commandInput = requireString(input, "command");
    if (!commandInput.ok) return commandInput.result;
    const timeoutInput = parseTimeout(input);
    if (!timeoutInput.ok) return toErrorResult(timeoutInput.message);
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) return verbosityInput.result;

    const sandboxContext = getSandboxContext(sandbox);
    const cwd = resolvePath(optionalString(input, "cwd") ?? sandboxContext?.cwd ?? process.cwd(), sandbox);
    const cwdError = validateReadPath(cwd, sandbox);
    if (cwdError) {
      return toErrorResult(cwdError, monitorToolMetadata("monitor_start", {
        operation: "start",
        command: commandInput.value,
        cwd,
        timeoutMs: timeoutInput.value,
        errorCode: "invalid_input",
        verbosity: verbosityInput.value,
      }));
    }
    const commandError = validateCommand(commandInput.value, cwd, sandbox);
    if (commandError) {
      return toErrorResult(commandError, monitorToolMetadata("monitor_start", {
        operation: "start",
        command: commandInput.value,
        cwd,
        timeoutMs: timeoutInput.value,
        errorCode: "invalid_input",
        verbosity: verbosityInput.value,
      }));
    }

    const monitor = this.registry.start({
      command: commandInput.value,
      cwd,
      name: optionalString(input, "name"),
      timeoutMs: timeoutInput.value,
    });
    const metadata = monitorToolMetadata("monitor_start", {
      operation: "start",
      id: monitor.id,
      name: monitor.name,
      command: monitor.command,
      cwd: monitor.cwd,
      status: monitor.status,
      timeoutMs: monitor.timeoutMs,
      sequence: monitor.sequence,
      verbosity: verbosityInput.value,
    });
    return toSuccessResult(formatMonitorStart(monitor, verbosityInput.value), metadata);
  }
}

export class MonitorReadTool implements DevTool {
  readonly name = "monitor_read";
  readonly description = TOOL_SCHEMAS.monitor_read.description;
  readonly inputSchema = TOOL_SCHEMAS.monitor_read.inputSchema;
  private readonly registry: MonitorRegistry;

  constructor(options: { readonly registry: MonitorRegistry }) {
    this.registry = options.registry;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const idInput = requireString(input, "id");
    if (!idInput.ok) return idInput.result;
    const sinceSequence = optionalNonNegativeInteger(input, "sinceSequence", 0);
    if (!sinceSequence.ok) return toErrorResult(sinceSequence.message);
    const limit = optionalPositiveInteger(input, "limit", DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
    if (!limit.ok) return toErrorResult(limit.message);
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) return verbosityInput.result;

    const result = this.registry.read(idInput.value, {
      sinceSequence: sinceSequence.value,
      limit: limit.value,
    });
    if (!result.snapshot) {
      return toErrorResult("Monitor not found", monitorToolMetadata("monitor_read", {
        operation: "read",
        id: idInput.value,
        sinceSequence: sinceSequence.value,
        errorCode: "not_found",
        verbosity: verbosityInput.value,
      }));
    }

    const metadata = monitorToolMetadata("monitor_read", {
      operation: "read",
      id: result.snapshot.id,
      status: result.snapshot.status,
      sequence: result.snapshot.sequence,
      sinceSequence: sinceSequence.value,
      eventCount: result.events.length,
      truncated: result.snapshot.truncated,
      verbosity: verbosityInput.value,
    });
    return toSuccessResult(formatMonitorRead(result.snapshot, result.events, verbosityInput.value), metadata);
  }
}

export class MonitorStopTool implements DevTool {
  readonly name = "monitor_stop";
  readonly description = TOOL_SCHEMAS.monitor_stop.description;
  readonly inputSchema = TOOL_SCHEMAS.monitor_stop.inputSchema;
  private readonly registry: MonitorRegistry;

  constructor(options: { readonly registry: MonitorRegistry }) {
    this.registry = options.registry;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const idInput = requireString(input, "id");
    if (!idInput.ok) return idInput.result;
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) return verbosityInput.result;

    const snapshot = await this.registry.stop(idInput.value, optionalString(input, "reason") ?? "operator requested stop");
    if (!snapshot) {
      return toErrorResult("Monitor not found", monitorToolMetadata("monitor_stop", {
        operation: "stop",
        id: idInput.value,
        errorCode: "not_found",
        verbosity: verbosityInput.value,
      }));
    }

    const metadata = monitorToolMetadata("monitor_stop", {
      operation: "stop",
      id: snapshot.id,
      name: snapshot.name,
      command: snapshot.command,
      cwd: snapshot.cwd,
      status: snapshot.status,
      eventCount: snapshot.sequence,
      exitCode: snapshot.exitCode,
      signal: snapshot.signal,
      durationMs: snapshot.durationMs,
      timedOut: snapshot.timedOut,
      truncated: snapshot.truncated,
      verbosity: verbosityInput.value,
    });
    return toSuccessResult(formatMonitorStop(snapshot, verbosityInput.value), metadata);
  }
}

export class MonitorListTool implements DevTool {
  readonly name = "monitor_list";
  readonly description = TOOL_SCHEMAS.monitor_list.description;
  readonly inputSchema = TOOL_SCHEMAS.monitor_list.inputSchema;
  private readonly registry: MonitorRegistry;

  constructor(options: { readonly registry: MonitorRegistry }) {
    this.registry = options.registry;
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const statusInput = parseStatus(input);
    if (!statusInput.ok) return toErrorResult(statusInput.message);
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) return verbosityInput.result;

    const monitors = this.registry.list(statusInput.value);
    const metadata = monitorToolMetadata("monitor_list", {
      operation: "list",
      status: statusInput.value,
      monitorCount: monitors.length,
      verbosity: verbosityInput.value,
    });
    return toSuccessResult(formatMonitorList(monitors, verbosityInput.value), metadata);
  }
}

export class SpawnMonitorCommandRunner implements MonitorCommandRunner {
  constructor(private readonly processRunner: CommandProcessRunner) {}

  start(request: MonitorCommandRequest, sink: MonitorOutputSink): MonitorProcessHandle {
    const handle = this.processRunner.start({
      executable: "bash",
      args: ["-c", request.command],
      cwd: request.cwd,
    }, {
      output: ({ stream, text }) => stream === "stdout" ? sink.stdout(text) : sink.stderr(text),
      finish: sink.finish,
    });
    return {
      pid: handle.pid,
      stop: async () => handle.stop("stopped"),
    };
  }
}

const unavailableMonitorCommandRunner: MonitorCommandRunner = {
  start(_request, sink) {
    sink.finish({ error: new Error("Monitor execution requires a Runtime-owned process runner") });
    return { async stop() {} };
  },
};

function parseTimeout(input: ToolInput): { ok: true; value: number } | { ok: false; message: string } {
  const timeout = optionalNumber(input, "timeout");
  if (timeout === undefined) {
    if (input.input["timeout"] !== undefined) {
      return { ok: false, message: 'Invalid input: "timeout" must be a finite number' };
    }
    return { ok: true, value: DEFAULT_TIMEOUT_MS };
  }
  if (timeout <= 0) {
    return { ok: false, message: 'Invalid input: "timeout" must be > 0' };
  }
  return { ok: true, value: Math.min(Math.floor(timeout), MAX_TIMEOUT_MS) };
}

function optionalNonNegativeInteger(
  input: ToolInput,
  key: string,
  defaultValue: number,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = optionalNumber(input, key);
  if (value === undefined) {
    if (input.input[key] !== undefined) {
      return { ok: false, message: `Invalid input: "${key}" must be a finite number` };
    }
    return { ok: true, value: defaultValue };
  }
  if (value < 0) {
    return { ok: false, message: `Invalid input: "${key}" must be >= 0` };
  }
  return { ok: true, value: Math.floor(value) };
}

function optionalPositiveInteger(
  input: ToolInput,
  key: string,
  defaultValue: number,
  maxValue: number,
): { ok: true; value: number } | { ok: false; message: string } {
  const value = optionalNumber(input, key);
  if (value === undefined) {
    if (input.input[key] !== undefined) {
      return { ok: false, message: `Invalid input: "${key}" must be a finite number` };
    }
    return { ok: true, value: defaultValue };
  }
  if (value <= 0) {
    return { ok: false, message: `Invalid input: "${key}" must be > 0` };
  }
  return { ok: true, value: Math.min(Math.floor(value), maxValue) };
}

function parseStatus(input: ToolInput): { ok: true; value?: MonitorStatus } | { ok: false; message: string } {
  const value = input.input["status"];
  if (value === undefined) {
    return { ok: true };
  }
  if (value === "running" || value === "exited" || value === "stopped" || value === "failed") {
    return { ok: true, value };
  }
  return { ok: false, message: 'Invalid input: "status" must be one of running, exited, stopped, or failed' };
}

function clampReadLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_READ_LIMIT;
  }
  return Math.max(1, Math.min(MAX_READ_LIMIT, Math.floor(value)));
}

function snapshot(record: MonitorRecord): MonitorSnapshot {
  return {
    id: record.id,
    name: record.name,
    command: record.command,
    cwd: record.cwd,
    status: record.status,
    timeoutMs: record.timeoutMs,
    startedAt: new Date(record.startedAtMs).toISOString(),
    completedAt: record.completedAtMs === undefined ? undefined : new Date(record.completedAtMs).toISOString(),
    durationMs: record.completedAtMs === undefined ? undefined : Math.max(0, record.completedAtMs - record.startedAtMs),
    pid: record.pid,
    sequence: record.events.length,
    exitCode: record.exitCode,
    signal: record.signal,
    timedOut: record.timedOut,
    truncated: record.truncated,
  };
}

function formatMonitorStart(snapshot: MonitorSnapshot, verbosity: "raw" | "structured" | "summary"): string {
  if (verbosity === "structured") {
    return JSON.stringify(snapshot, null, 2);
  }
  if (verbosity === "summary") {
    return `Monitor ${snapshot.id} ${snapshot.status}; sequence ${snapshot.sequence}`;
  }
  return `Started monitor ${snapshot.id} (${snapshot.command})`;
}

function formatMonitorRead(
  snapshot: MonitorSnapshot,
  events: readonly MonitorEvent[],
  verbosity: "raw" | "structured" | "summary",
): string {
  if (verbosity === "structured") {
    return JSON.stringify({ ...snapshot, events }, null, 2);
  }
  if (verbosity === "summary") {
    return `Monitor ${snapshot.id} ${snapshot.status}; ${events.length} events; sequence ${snapshot.sequence}`;
  }
  return events.map((event) => event.text).join("");
}

function formatMonitorStop(snapshot: MonitorSnapshot, verbosity: "raw" | "structured" | "summary"): string {
  if (verbosity === "structured") {
    return JSON.stringify(snapshot, null, 2);
  }
  if (verbosity === "summary") {
    return `Monitor ${snapshot.id} ${snapshot.status}; sequence ${snapshot.sequence}`;
  }
  return `Stopped monitor ${snapshot.id}: ${snapshot.status}`;
}

function formatMonitorList(snapshots: readonly MonitorSnapshot[], verbosity: "raw" | "structured" | "summary"): string {
  if (verbosity === "structured") {
    return JSON.stringify({ monitors: snapshots }, null, 2);
  }
  if (verbosity === "summary") {
    return `${snapshots.length} monitors`;
  }
  if (snapshots.length === 0) {
    return "No monitors";
  }
  return snapshots.map((snapshot) => [
    snapshot.id,
    snapshot.status,
    snapshot.name ?? snapshot.command,
    `seq=${snapshot.sequence}`,
  ].join("\t")).join("\n");
}
