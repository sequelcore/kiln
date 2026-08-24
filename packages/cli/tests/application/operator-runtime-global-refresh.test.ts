import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGlobal: vi.fn(),
  createProject: vi.fn(),
  closeGlobal: vi.fn(),
}));

vi.mock("../../src/application/operator-project-agent-tasks.js", () => ({
  createOperatorGlobalManagedAccountComposition: mocks.createGlobal,
  createOperatorProjectAgentTaskApplicationComposition: mocks.createProject,
}));
vi.mock("../../src/config/managed-agent-routes.js", () => ({
  closeManagedAccountRuntimeComposition: mocks.closeGlobal,
}));

import {
  verifyOperatorSessionCredential,
} from "@kilnai/runtime";
import {
  createOperatorRuntimeService,
  type OperatorRuntimeSessionOpenInput,
} from "../../src/application/operator-runtime-service.js";
import type { TrustedWorkspaceResolution } from "../../src/application/trusted-workspace-resolution.js";

const SECRET = new TextEncoder().encode("operator-runtime-global-refresh-test-secret");
const ROOT = "C:\\synthetic\\global-refresh";
const PROJECT_RUNTIME_ID = `krp_${"a".repeat(64)}` as `krp_${string}`;
const PROJECT_REVISION_A = `sha256:${"b".repeat(64)}` as `sha256:${string}`;
const PROJECT_REVISION_B = `sha256:${"c".repeat(64)}` as `sha256:${string}`;
const PROJECT_REVISION_C = `sha256:${"e".repeat(64)}` as `sha256:${string}`;
const GLOBAL_REVISION_A = `sha256:${"d".repeat(64)}` as `sha256:${string}`;
const GLOBAL_REVISION_B = `sha256:${"f".repeat(64)}` as `sha256:${string}`;

describe("operator runtime global composition refresh", () => {
  it("refreshes only when global revision changes, not for project-only rebuilds", async () => {
    let currentCompositionRevision = PROJECT_REVISION_A;
    let currentGlobalRevision = GLOBAL_REVISION_A;
    const globalAuthorities: object[] = [];
    const projectCompositions: Array<{ readonly close: ReturnType<typeof vi.fn> }> = [];
    mocks.createGlobal.mockImplementation(() => {
      const authority = {};
      globalAuthorities.push(authority);
      return { authority };
    });
    mocks.createProject.mockImplementation(({ managedAccountComposition }: {
      readonly managedAccountComposition?: { readonly authority?: object };
    }) => {
      const close = vi.fn(async () => undefined);
      projectCompositions.push({ close });
      return {
        service: {},
        application: {
          accept: vi.fn(),
          getStatus: vi.fn(),
          getResult: vi.fn(),
          cancel: vi.fn(),
          getReplay: vi.fn(),
          approveWrite: vi.fn(),
        },
        configuredAgents: [],
        economicAuthority: {
          acquire: vi.fn(),
          releasePreFence: vi.fn(),
          fenceDispatch: vi.fn(),
          readDispatch: vi.fn(),
          settleExecution: vi.fn(),
          recordExecutionSettlementPending: vi.fn(),
          sourceAuthority: managedAccountComposition?.authority,
        },
        close,
      };
    });

    const service = createOperatorRuntimeService({
      sessionSecret: SECRET,
      nowEpochSeconds: () => 100,
      resolveWorkspace: (): TrustedWorkspaceResolution => ({
        status: "resolved" as const,
        canonicalRoot: ROOT,
        projectRuntimeId: PROJECT_RUNTIME_ID,
        projectStateRoot: `${ROOT}\\.kiln\\state`,
        adoptionRevision: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
        compositionRevision: currentCompositionRevision,
        globalConfigRevision: currentGlobalRevision,
      }),
    });

    const first = await service.onSessionOpen(sessionInput(PROJECT_REVISION_A, "first-session"));
    await releasePreFence(service, first.credential, PROJECT_REVISION_A, "first-session", "job-a");

    currentCompositionRevision = PROJECT_REVISION_B;
    const second = await service.onSessionOpen(sessionInput(PROJECT_REVISION_B, "second-session"));
    await releasePreFence(service, second.credential, PROJECT_REVISION_B, "second-session", "job-b");

    expect(globalAuthorities).toHaveLength(1);
    expect(projectCompositions).toHaveLength(2);
    expect(projectCompositions[0]!.close).toHaveBeenCalledOnce();
    expect(mocks.closeGlobal).not.toHaveBeenCalled();

    currentCompositionRevision = PROJECT_REVISION_C;
    currentGlobalRevision = GLOBAL_REVISION_B;
    const third = await service.onSessionOpen(sessionInput(PROJECT_REVISION_C, "third-session"));
    await releasePreFence(service, third.credential, PROJECT_REVISION_C, "third-session", "job-c");

    expect(globalAuthorities).toHaveLength(2);
    expect(globalAuthorities[0]).not.toBe(globalAuthorities[1]);
    expect(projectCompositions).toHaveLength(3);
    expect(projectCompositions[1]!.close).toHaveBeenCalledOnce();
    expect(mocks.closeGlobal).toHaveBeenCalledOnce();
    await service.close();
    expect(mocks.closeGlobal).toHaveBeenCalledTimes(2);
  });
});

async function releasePreFence(
  service: ReturnType<typeof createOperatorRuntimeService>,
  credential: string,
  compositionRevision: string,
  sessionId: string,
  jobId: string,
): Promise<void> {
  const claims = verify(credential, compositionRevision, sessionId);
  await expect(service.onApplicationRequest({
    claims,
    request: {
      schemaVersion: 1,
      operation: "managed-economic.release-pre-fence",
      jobId,
      economicAttemptId: `attempt-${jobId}`,
    },
  })).resolves.toMatchObject({ status: "ok" });
}

function sessionInput(compositionRevision: string, sessionId: string): OperatorRuntimeSessionOpenInput {
  return {
    schemaVersion: 3,
    canonicalRoot: ROOT,
    binding: { projectRuntimeId: PROJECT_RUNTIME_ID, compositionRevision },
    principal: { kind: "operator-surface", surface: "gui" },
    sessionId,
  };
}

function verify(credential: string, compositionRevision: string, sessionId: string) {
  return verifyOperatorSessionCredential(credential, SECRET, {
    projectRuntimeId: PROJECT_RUNTIME_ID,
    compositionRevision,
    principal: { kind: "operator-surface", surface: "gui" },
    sessionId,
  }, { nowEpochSeconds: 100 });
}
