import type { ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { uniqueStrings } from "./runtime-primitives.js";
import type {
  ManagedAgentWorktreeLeaseManagerInput as ManagedAgentSandboxLeaseManagerInputBase,
  ManagedAgentWorktreeLeaseReleaseInput as ManagedAgentSandboxLeaseReleaseInputBase,
} from "./worktree-lease-manager.js";

export type ManagedAgentSandboxLeaseManagerInput = ManagedAgentSandboxLeaseManagerInputBase;

export type ManagedAgentSandboxLeaseReleaseInput = ManagedAgentSandboxLeaseReleaseInputBase;

export interface ManagedAgentSandboxLeaseManager {
  acquire(input: ManagedAgentSandboxLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentSandboxLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export class ManagedRuntimeSandboxLeaseManager implements ManagedAgentSandboxLeaseManager {
  async acquire(input: ManagedAgentSandboxLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    if (input.request.authority.workingDirectory.mode !== "sandbox") {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        sandboxPolicyResourceUri(input.request.invocationId),
      ]),
    };
  }

  async release(input: ManagedAgentSandboxLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    if (input.request.authority.workingDirectory.mode !== "sandbox") {
      return input.lease;
    }
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        sandboxPolicyReleaseUri(input.request.invocationId),
      ]),
    };
  }
}

export function sandboxPolicyResourceUri(invocationId: string): string {
  return `kiln://artifacts/${invocationId}/sandbox-policy`;
}

export function sandboxPolicyReleaseUri(invocationId: string): string {
  return `kiln://artifacts/${invocationId}/sandbox-policy-release`;
}
