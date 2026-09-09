import { readFile } from "node:fs/promises";
import {
  ManagedEconomicNotDispatchedReconciliationInputSchema,
  ManagedEconomicExecutionReconciliationInputSchema,
  OperatorRuntimeApplicationResponseSchema,
} from "@kilnai/gateway-contracts";
import { OPERATOR_RUNTIME_APPLICATION_PATH } from "@kilnai/runtime";
import pkg from "../../package.json" with { type: "json" };
import { createOperatorRuntimeClientSession, type OperatorRuntimeClientSession } from "../application/operator-runtime-client-session.js";
import { createGlobalOperatorRuntimeLifecycle } from "../application/operator-runtime-lifecycle.js";

interface ManagedEconomicCommandDependencies {
  readonly readEvidence: (path: string) => Promise<string>;
  readonly createSession: () => OperatorRuntimeClientSession;
  readonly log: (message: string) => void;
}

const defaultDependencies: ManagedEconomicCommandDependencies = {
  readEvidence: (path) => readFile(path, "utf8"),
  createSession: () => {
    const lifecycle = createGlobalOperatorRuntimeLifecycle({
      version: pkg.version,
      execPath: process.execPath,
      entrypoint: process.argv[1] ?? "",
    });
    return createOperatorRuntimeClientSession({
      principal: { kind: "operator-surface", surface: "cli" },
      supervisor: lifecycle.supervisor,
      readBridgeCredentials: lifecycle.readBridgeCredentials,
    });
  },
  log: (message) => console.log(message),
};

/** Explicit operator attestations bound to reviewed evidence, validated by the durable owner. */
export async function managedEconomicCommand(
  args: readonly string[],
  overrides: Partial<ManagedEconomicCommandDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...overrides };
  if (args.length === 0 || args[0] === "--help") {
    dependencies.log("Usage: kiln managed-economic <reconcile-not-dispatched|reconcile-execution> --evidence <file.json> [--json]\nReconciliation requires evidence of no dispatch or stopped execution with recovered usage. Missing results are insufficient.");
    return;
  }
  const [operation, flag, path, format] = args;
  if ((operation !== "reconcile-not-dispatched" && operation !== "reconcile-execution") || flag !== "--evidence" || !path
    || path.startsWith("--") || args.length > 4 || (format !== undefined && format !== "--json")) {
    throw new Error("Expected reconcile-not-dispatched or reconcile-execution --evidence <file.json> [--json].");
  }
  const input = (operation === "reconcile-execution"
    ? ManagedEconomicExecutionReconciliationInputSchema
    : ManagedEconomicNotDispatchedReconciliationInputSchema).parse(
    JSON.parse(await dependencies.readEvidence(path)) as unknown,
  );
  const session = dependencies.createSession();
  try {
    const response = await session.request(OPERATOR_RUNTIME_APPLICATION_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, operation: `managed-economic.${operation}`, input }),
    });
    if (!response.ok) throw new Error(`Operator Runtime rejected economic reconciliation (${response.status}).`);
    const result = OperatorRuntimeApplicationResponseSchema.parse(await response.json());
    if (result.status === "error") throw new Error(`Economic reconciliation rejected (${result.error.code}): ${result.error.message}`);
    dependencies.log(format === "--json"
      ? JSON.stringify(result.result)
      : `Reconciled ${input.jobId}; its reservation is released and replay remains fenced.`);
  } finally {
    session.close();
  }
}
