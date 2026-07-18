import { EOL } from "node:os";

export type RuntimeTraceSeverity = "info" | "warn" | "error";
export type RuntimeTraceFormat = "human" | "json";
export type RuntimeTraceLevel = RuntimeTraceSeverity | "silent";

export interface RuntimeTraceRecord {
  readonly observedAt: string;
  readonly severity: RuntimeTraceSeverity;
  readonly traceId: string;
  readonly component: string;
  readonly message: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface RuntimeTraceSink {
  write(record: RuntimeTraceRecord): void;
}

interface ProcessTraceSinkOptions {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
  readonly format: RuntimeTraceFormat;
  readonly minSeverity?: RuntimeTraceLevel;
}

const DEFAULT_PROCESS_TRACE_SINK = createProcessTraceSink({
  stdout: process.stdout,
  stderr: process.stderr,
  format: process.env.KILN_LOG_FORMAT === "json" ? "json" : "human",
  minSeverity: parseRuntimeTraceLevel(
    process.env.KILN_LOG_LEVEL,
    process.env.NODE_ENV === "test" ? "silent" : "warn",
  ),
});

export function createProcessTraceSink(options: ProcessTraceSinkOptions): RuntimeTraceSink {
  const minSeverity = options.minSeverity ?? "info";
  return {
    write(record) {
      if (!shouldWrite(record.severity, minSeverity)) {
        return;
      }
      const line = options.format === "json"
        ? serializeTraceRecord(record)
        : formatHumanTraceRecord(record);
      const output = record.severity === "info" ? options.stdout : options.stderr;
      output.write(`${line}${EOL}`);
    },
  };
}

function parseRuntimeTraceLevel(
  value: string | undefined,
  defaultLevel: RuntimeTraceLevel,
): RuntimeTraceLevel {
  const normalized = value?.trim().toLowerCase();
  return normalized === "info"
    || normalized === "warn"
    || normalized === "error"
    || normalized === "silent"
    ? normalized
    : defaultLevel;
}

function shouldWrite(severity: RuntimeTraceSeverity, minSeverity: RuntimeTraceLevel): boolean {
  if (minSeverity === "silent") {
    return false;
  }
  const rank: Record<RuntimeTraceSeverity, number> = {
    info: 0,
    warn: 1,
    error: 2,
  };
  return rank[severity] >= rank[minSeverity];
}

export class TraceContext {
  readonly traceId: string;

  constructor(
    traceId?: string,
    private readonly sink: RuntimeTraceSink = DEFAULT_PROCESS_TRACE_SINK,
  ) {
    this.traceId = traceId ?? crypto.randomUUID();
  }

  log(component: string, message: string, attributes?: Record<string, unknown>): void {
    this.write("info", component, message, attributes);
  }

  warn(component: string, message: string, attributes?: Record<string, unknown>): void {
    this.write("warn", component, message, attributes);
  }

  error(component: string, message: string, attributes?: Record<string, unknown>): void {
    this.write("error", component, message, attributes);
  }

  private write(
    severity: RuntimeTraceSeverity,
    component: string,
    message: string,
    attributes?: Record<string, unknown>,
  ): void {
    this.sink.write({
      observedAt: new Date().toISOString(),
      severity,
      traceId: this.traceId,
      component,
      message,
      ...(attributes ? { attributes } : {}),
    });
  }
}

function formatHumanTraceRecord(record: RuntimeTraceRecord): string {
  const severity = record.severity === "warn"
    ? "Warning: "
    : record.severity === "error"
      ? "Error: "
      : "";
  const attributes = record.attributes ? ` ${serializeTraceAttributes(record.attributes)}` : "";
  return `[${record.traceId}] [${record.component}] ${severity}${singleLine(record.message)}${attributes}`;
}

function singleLine(value: string): string {
  return value.replace(/\r\n?|\n/gu, "\\n");
}

function serializeTraceRecord(record: RuntimeTraceRecord): string {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({
      ...record,
      attributes: { serializationError: "unserializable trace attributes" },
    });
  }
}

function serializeTraceAttributes(attributes: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(attributes);
  } catch {
    return JSON.stringify({ serializationError: "unserializable trace attributes" });
  }
}
