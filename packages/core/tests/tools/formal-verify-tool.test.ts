import { describe, expect, it } from "vitest";
import {
  createFormalVerifyTool,
  FORMAL_VERIFY_CAPABILITY,
} from "../../src/tools/infrastructure/formal-verify-tool.js";
import { TOOL_SCHEMAS } from "../../src/tools/domain/tool.js";
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
