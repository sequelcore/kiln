import { randomUUID } from "node:crypto";
import pkg from "../../package.json" with { type: "json" };
import {
  AgentTaskCapabilitySubmissionSchema,
  type AgentTaskCapabilitySubmission,
} from "@kilnai/gateway-contracts";
import { createOperatorRuntimeAgentTaskClient, type OperatorRuntimeAgentTaskClient } from "../application/operator-runtime-agent-tasks.js";
import { createOperatorRuntimeClientSession } from "../application/operator-runtime-client-session.js";
import { createGlobalOperatorRuntimeLifecycle } from "../application/operator-runtime-lifecycle.js";

const TERMINAL_STATES = new Set(["succeeded", "failed", "timed_out", "interrupted", "cancelled"]);

interface AgentTaskCommandDependencies {
  readonly createClient: () => { readonly client: OperatorRuntimeAgentTaskClient; close(): void };
  readonly createIdempotencyKey: () => string;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly log: (message: string) => void;
}

interface ParsedFlags {
  readonly json: boolean;
  readonly wait: boolean;
  readonly profile?: string;
  readonly idempotencyKey?: string;
  readonly capability?: AgentTaskCapabilitySubmission;
  readonly positional: readonly string[];
}

const defaultDependencies: AgentTaskCommandDependencies = {
  createClient: () => {
    const lifecycle = createGlobalOperatorRuntimeLifecycle({
      version: pkg.version,
      execPath: process.execPath,
      entrypoint: process.argv[1] ?? "",
    });
    const session = createOperatorRuntimeClientSession({
      principal: { kind: "operator-surface", surface: "cli" },
      supervisor: lifecycle.supervisor,
      readBridgeCredentials: lifecycle.readBridgeCredentials,
    });
    return { client: createOperatorRuntimeAgentTaskClient(session), close: () => session.close() };
  },
  createIdempotencyKey: () => `cli-${randomUUID()}`,
  delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log: console.log,
};

export async function agentTaskCommand(
  args: readonly string[],
  overrides: Partial<AgentTaskCommandDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const operation = args[0];
  if (!operation || operation === "--help" || operation === "-h") {
    printHelp(dependencies.log);
    return;
  }
  if (!["submit", "status", "result", "cancel", "replay"].includes(operation)) {
    throw new Error(`Unknown agent-task command '${operation}'.`);
  }
  const flags = parseFlags(args.slice(1));
  const connection = dependencies.createClient();
  try {
    if (operation === "submit") {
      if (!flags.profile) throw new Error("agent-task submit requires --profile <id>.");
      const objective = flags.positional.join(" ").trim();
      if (!objective) throw new Error("agent-task submit requires an objective.");
      const submitted = await connection.client.submit({
        objective,
        configuredAgentProfileId: flags.profile,
        idempotencyKey: flags.idempotencyKey ?? dependencies.createIdempotencyKey(),
        ...(flags.capability ? { capability: flags.capability } : {}),
      });
      printValue("submitted", submitted, flags.json, dependencies.log);
      if (flags.wait) await waitForTerminal(connection.client, requireJobId(submitted), flags.json, dependencies);
      return;
    }
    if (flags.wait || flags.profile || flags.idempotencyKey || flags.capability || flags.positional.length !== 1) {
      throw new Error(`agent-task ${operation} requires exactly one job id.`);
    }
    const jobId = requireIdentifier(flags.positional[0], "job id");
    const value = operation === "status"
      ? await connection.client.status(jobId)
      : operation === "result"
        ? await connection.client.result(jobId)
        : operation === "cancel"
          ? await connection.client.cancel(jobId)
          : await connection.client.replay(jobId);
    printValue(operation, value, flags.json, dependencies.log);
  } finally {
    connection.close();
  }
}

async function waitForTerminal(
  client: OperatorRuntimeAgentTaskClient,
  jobId: string,
  json: boolean,
  dependencies: AgentTaskCommandDependencies,
): Promise<void> {
  for (;;) {
    const status = await client.status(jobId);
    const state = readString(status, "state");
    if (state && TERMINAL_STATES.has(state)) {
      const value = state === "succeeded" ? await client.result(jobId) : status;
      printValue(state === "succeeded" ? "result" : "terminal", value, json, dependencies.log);
      return;
    }
    await dependencies.delay(1_000);
  }
}

function parseFlags(args: readonly string[]): ParsedFlags {
  let json = false;
  let wait = false;
  let profile: string | undefined;
  let idempotencyKey: string | undefined;
  let capability: AgentTaskCapabilitySubmission | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") { json = true; continue; }
    if (arg === "--wait") { wait = true; continue; }
    if (arg === "--profile" || arg === "--idempotency-key" || arg === "--capability") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--profile") profile = requireIdentifier(value, "profile id");
      else if (arg === "--idempotency-key") idempotencyKey = requireIdentifier(value, "idempotency key");
      else capability = parseCapability(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown agent-task option '${arg}'. Account, provider, model, and routing are Runtime-owned.`);
    }
    positional.push(arg);
  }
  return {
    json,
    wait,
    positional,
    ...(profile ? { profile } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(capability ? { capability } : {}),
  };
}

function parseCapability(value: string): AgentTaskCapabilitySubmission {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Agent-task capability must be valid JSON.");
  }
  const result = AgentTaskCapabilitySubmissionSchema.safeParse(parsed);
  if (!result.success) throw new Error("Agent-task capability does not match the typed vision.analyze/v1 contract.");
  return result.data;
}

function printValue(operation: string, value: unknown, json: boolean, log: (message: string) => void): void {
  const projection = projectOperatorValue(operation, value);
  if (json) {
    log(JSON.stringify(projection));
    return;
  }
  const route = projection.routeId
    ? ` via ${projection.routeId}${projection.providerId ? ` (${projection.providerId})` : ""}`
    : "";
  const diagnostic = projection.diagnostic ? ` [${projection.diagnostic}]` : "";
  log(`Agent Task ${projection.jobId}: ${projection.state ?? operation}${route}.${diagnostic}`);
  if (projection.summary) log(projection.summary);
  if (projection.resourceUris && projection.resourceUris.length > 0) {
    log(`Resources:\n${projection.resourceUris.map((uri) => `- ${uri}`).join("\n")}`);
  }
}

interface AgentTaskOperatorProjection {
  readonly operation: string;
  readonly jobId: string;
  readonly state?: string;
  readonly availability?: string;
  readonly configuredAgentProfileId?: string;
  readonly admissionProfileId?: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly diagnostic?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly completedAt?: string;
  readonly dispatchKind?: string;
  readonly summary?: string;
  readonly resourceUris?: readonly string[];
  readonly memoryWriteProposalUris?: readonly string[];
}

function projectOperatorValue(operation: string, value: unknown): AgentTaskOperatorProjection {
  const record = isRecord(value) ? value : {};
  const nestedResult = readRecord(record, "result");
  const handoff = readRecord(record, "handoff") ?? readRecord(nestedResult, "resultHandoff");
  const dispatch = readRecord(record, "dispatch");
  const state = readString(record, "state") ?? readString(record, "lifecycleState") ?? readString(record, "availability");
  return compact({
    operation,
    jobId: readString(record, "id") ?? readString(record, "jobId") ?? "unknown",
    state,
    availability: readString(record, "availability") ?? readString(record, "resultAvailability"),
    configuredAgentProfileId: readString(record, "configuredAgentProfileId"),
    admissionProfileId: readString(record, "admissionProfileId"),
    routeId: readString(record, "routeId") ?? readString(nestedResult, "routeId"),
    providerId: readString(record, "providerId") ?? readString(nestedResult, "providerId"),
    diagnostic: readString(record, "diagnostic"),
    createdAt: readString(record, "createdAt"),
    updatedAt: readString(record, "updatedAt"),
    completedAt: readString(record, "completedAt") ?? readString(nestedResult, "completedAt"),
    dispatchKind: readString(dispatch, "kind"),
    summary: readString(handoff, "summary"),
    resourceUris: readStringArray(handoff, "resourceUris"),
    memoryWriteProposalUris: readStringArray(handoff, "memoryWriteProposalUris"),
  });
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function requireJobId(value: unknown): string {
  return requireIdentifier(readString(value, "id"), "submitted job id");
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)) {
    throw new Error(`Agent Task ${field} is invalid.`);
  }
  return value;
}

function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function readStringArray(value: unknown, key: string): readonly string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value[key]) || !value[key].every((entry) => typeof entry === "string")) return undefined;
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printHelp(log: (message: string) => void): void {
  log("\nUsage: kiln agent-task submit --profile <id> [--capability <json>] [--wait] [--json] <objective>");
  log("       kiln agent-task <status|result|cancel|replay> [--json] <job-id>\n");
}
