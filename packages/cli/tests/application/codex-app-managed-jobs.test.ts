import { describe, expect, it } from "vitest";
import { createCodexAppManagedJobApplicationService } from "../../src/application/codex-app-managed-jobs.js";

describe("Codex App managed-job production composition", () => {
  it("uses the real application owner and fails a missing configured profile before provider execution", async () => {
    const service = await createCodexAppManagedJobApplicationService();
    await expect(service.submit({
      objective: "Bounded production composition proof.",
      agentProfileId: "foundation-readonly-plan",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    await expect(service.status("unknown-managed-job-0001")).rejects.toMatchObject({ code: "unknown_job" });
  });
});
