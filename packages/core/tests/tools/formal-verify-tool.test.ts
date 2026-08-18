import { describe, expect, it } from "vitest";
import {
  createFormalVerifyTool,
  formalProofObligations,
  FORMAL_VERIFY_CAPABILITY,
} from "../../src/tools/infrastructure/formal-verify-tool.js";
import type { DafnyProofLog } from "../../src/verification/dafny-proof-log.js";
import { TOOL_SCHEMAS } from "../../src/tools/domain/tool.js";
import { createDefaultBuiltinTools } from "../../src/tools/default-tool-surface.js";
import { BUILTIN_TOOL_EFFECT_ENVELOPES } from "../../src/tools/domain/tool-effect-envelopes.js";
import type {
  CommandProcessRequest,
  CommandProcessResult,
  CommandProcessRunner,
  CommandProcessSink,
} from "../../src/tools/infrastructure/command-process.js";

class ScriptedRunner implements CommandProcessRunner {
  request?: CommandProcessRequest;
  constructor(private readonly result: CommandProcessResult = { exitCode: 0 }) {}
  start(request: CommandProcessRequest, sink: CommandProcessSink) {
    this.request = request;
    sink.finish(this.result);
    return { stop: async () => {} };
  }
}

const tool = (runner: CommandProcessRunner = new ScriptedRunner()) =>
  createFormalVerifyTool({ executable: "dafny", runner });

const call = (file: unknown) => ({ input: { file } }) as never;

describe("formal_verify registration", () => {
  it("declares a schema that does not accept an acceptance-criterion mapping", () => {
    const properties = (TOOL_SCHEMAS.formal_verify.inputSchema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    });
    expect(Object.keys(properties.properties)).toEqual(["file"]);
    expect(properties.additionalProperties).toBe(false);
  });

  it("declares an effect envelope that admits process, workspace, and machine boundaries", () => {
    const envelope = BUILTIN_TOOL_EFFECT_ENVELOPES.formal_verify;
    expect(envelope.operation).toBe("mutate");
    expect([...envelope.boundaries].sort()).toEqual(["machine", "process", "workspace"]);
    expect(envelope.dataEgress).toBe("none");
    expect(envelope.idempotency).toBe("conditionally-idempotent");
  });

  it("names the capability identity it implements", () => {
    expect(FORMAL_VERIFY_CAPABILITY).toBe("verify.formal");
  });

  it("exposes the registered schema", () => {
    expect(tool().name).toBe("formal_verify");
    expect(tool().effectEnvelope).toBeDefined();
  });
});

describe("formal_verify execution", () => {
  it("rejects a call without a file", async () => {
    const result = await tool().execute(call(undefined));
    expect(result.isError).toBe(true);
  });

  it("reports a run that did not complete as an error, not as a clean verification", async () => {
    const result = await tool(new ScriptedRunner({ timedOut: true })).execute(call("policy.dfy"));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("did not complete");
    expect(result.output).toContain("timed_out");
  });

  it("reports a missing executable as an error", async () => {
    const result = await tool(
      new ScriptedRunner({ error: new Error("spawn dafny ENOENT") }),
    ).execute(call("policy.dfy"));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("ENOENT");
  });

  it("does not claim acceptance when a completed run discharged nothing", async () => {
    // The scripted runner writes no log, so the run completes with no efforts.
    const result = await tool().execute(call("policy.dfy"));
    expect(result.isError).toBe(true);
  });
});

describe("formalProofObligations", () => {
  const log = (outcome: "passed" | "failed"): DafnyProofLog => ({
    efforts: [
      { symbol: "admitPath", check: "correctness", outcome, durationMs: 50, resourceCount: 26991 },
      { symbol: "admitPath", check: "well-formedness", outcome: "passed", durationMs: 20, resourceCount: 100 },
      { symbol: "helperOnly", check: "correctness", outcome: "passed", durationMs: 10, resourceCount: 50 },
    ],
    diagnostics:
      outcome === "failed"
        ? [{ file: "policy.dfy", line: 44, character: 4, message: "a postcondition could not be proved", related: ["this is the postcondition"] }]
        : [],
  });

  it("maps a discharged correctness effort to a proved obligation", () => {
    const obligations = formalProofObligations({
      log: log("passed"),
      criterionBySymbol: { admitPath: "AC-1" },
    });
    expect(obligations).toEqual([
      { id: "admitPath/correctness", criterionId: "AC-1", outcome: "proved" },
    ]);
  });

  it("omits symbols the contract did not map, so they cannot credit a criterion", () => {
    const obligations = formalProofObligations({
      log: log("passed"),
      criterionBySymbol: { admitPath: "AC-1" },
    });
    expect(obligations.some((o) => o.id.startsWith("helperOnly"))).toBe(false);
  });

  it("ignores well-formedness efforts, which do not establish implementation correctness", () => {
    const obligations = formalProofObligations({
      log: log("passed"),
      criterionBySymbol: { admitPath: "AC-1" },
    });
    expect(obligations).toHaveLength(1);
    expect(obligations[0]?.id).toBe("admitPath/correctness");
  });

  it("carries the verifier diagnostic as detail on a refuted obligation", () => {
    const [obligation] = formalProofObligations({
      log: log("failed"),
      criterionBySymbol: { admitPath: "AC-1" },
    });
    expect(obligation?.outcome).toBe("refuted");
    expect(obligation?.detail).toContain("policy.dfy:44:4");
  });

  it("returns nothing when the contract mapped no symbol", () => {
    expect(formalProofObligations({ log: log("passed"), criterionBySymbol: {} })).toEqual([]);
  });
});

describe("formal_verify in the default tool surface", () => {
  it("is absent when no verifier executable is configured", () => {
    const names = createDefaultBuiltinTools({}).map((tool) => tool.name);
    expect(names).not.toContain("formal_verify");
  });

  it("is offered once a verifier is configured", () => {
    const names = createDefaultBuiltinTools({ formalVerify: { executable: "dafny" } })
      .map((tool) => tool.name);
    expect(names).toContain("formal_verify");
  });

  it("carries its effect envelope into the surface", () => {
    const tool = createDefaultBuiltinTools({ formalVerify: { executable: "dafny" } })
      .find((entry) => entry.name === "formal_verify");
    expect(tool?.effectEnvelope?.operation).toBe("mutate");
  });
});
