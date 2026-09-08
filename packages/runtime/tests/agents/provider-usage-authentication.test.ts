import { describe, expect, it } from "vitest";
import { parseCodexProviderUsage } from "../../src/agents/provider-usage/codex-provider-usage.js";

describe("usage authentication evidence", () => {
  it("preserves rejection independently of usable quota headers", () => {
    const snapshot = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "work",
      observedAt: "2026-09-08T07:00:00.000Z",
      validUntil: "2026-09-08T07:05:00.000Z",
      headers: new Headers({ "x-codex-primary-used-percent": "20" }),
      failure: { httpStatus: 401 },
    });
    expect(snapshot).toMatchObject({
      httpStatus: 401,
      source: "provider-response-headers",
      primary: { usedPercent: 20 },
    });
  });
});
