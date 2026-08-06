import type { ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { ManagedAgentLeaseAcquireError } from "./lease-errors.js";
import { uniqueStrings } from "./runtime-primitives.js";
import { readDevServerPortLeaseValue } from "./dev-server-port-lease-manager.js";
import type {
  ManagedAgentWorktreeLeaseManagerInput as ManagedAgentEnvironmentLeaseManagerInputBase,
  ManagedAgentWorktreeLeaseReleaseInput as ManagedAgentEnvironmentLeaseReleaseInputBase,
} from "./worktree-lease-manager.js";

export type ManagedAgentEnvironmentVariables = Readonly<Record<string, string>>;

export type ManagedAgentEnvironmentLeaseManagerInput = ManagedAgentEnvironmentLeaseManagerInputBase;

export type ManagedAgentEnvironmentLeaseReleaseInput = ManagedAgentEnvironmentLeaseReleaseInputBase;

export interface ManagedAgentEnvironmentLease {
  readonly lease: ManagedAgentResourceLeaseEvidence;
  readonly environment: ManagedAgentEnvironmentVariables;
}

export interface ManagedAgentEnvironmentLeaseManager {
  acquire(input: ManagedAgentEnvironmentLeaseManagerInput): Promise<ManagedAgentEnvironmentLease>;
  release(input: ManagedAgentEnvironmentLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export type ManagedRuntimeEnvironmentBinding =
  | {
    readonly name: string;
    readonly value: string;
  }
  | {
    readonly name: string;
    readonly valueFrom: "dev-server-port";
  };

export interface ManagedRuntimeEnvironmentLeaseManagerConfig {
  readonly bindings: readonly ManagedRuntimeEnvironmentBinding[];
}

class ManagedAgentEnvironmentLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

export class ManagedRuntimeEnvironmentLeaseManager implements ManagedAgentEnvironmentLeaseManager {
  private readonly bindings: readonly ManagedRuntimeEnvironmentBinding[];

  constructor(config: ManagedRuntimeEnvironmentLeaseManagerConfig) {
    if (config.bindings.length === 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed environment lease manager requires at least one binding");
    }
    this.bindings = config.bindings.map((binding) => ({
      ...binding,
      name: validateEnvironmentName(binding.name),
    }));
    assertNoEnvironmentNameCollisions(this.bindings.map((binding) => binding.name));
  }

  async acquire(input: ManagedAgentEnvironmentLeaseManagerInput): Promise<ManagedAgentEnvironmentLease> {
    const environment = Object.create(null) as Record<string, string>;
    for (const binding of this.bindings) {
      environment[binding.name] = this.resolveBindingValue(input, binding);
    }
    return {
      lease: {
        ...input.lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: uniqueStrings([
          ...input.lease.resourceUris,
          ...this.bindings.map((binding) => environmentBindingResourceUri(input.request.invocationId, binding.name)),
        ]),
      },
      environment,
    };
  }

  async release(input: ManagedAgentEnvironmentLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        ...this.bindings.map((binding) => environmentBindingReleaseUri(input.request.invocationId, binding.name)),
      ]),
    };
  }

  private resolveBindingValue(
    input: ManagedAgentEnvironmentLeaseManagerInput,
    binding: ManagedRuntimeEnvironmentBinding,
  ): string {
    if ("value" in binding) {
      return binding.value;
    }
    const port = readDevServerPortLeaseValue(input.request.invocationId, input.lease.resourceUris);
    if (port === undefined) {
      throw new ManagedAgentEnvironmentLeaseAcquireError(
        "Managed environment binding requires a dev-server port lease",
        false,
      );
    }
    return String(port);
  }
}

export function environmentBindingResourceUri(invocationId: string, name: string): string {
  return `kiln://artifacts/${invocationId}/environment/${name}`;
}

export function environmentBindingReleaseUri(invocationId: string, name: string): string {
  return `kiln://artifacts/${invocationId}/environment-release/${name}`;
}

export function validateEnvironmentName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment binding name must be a portable environment variable name");
  }
  if (isReservedEnvironmentBindingName(name)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment binding name is a reserved environment binding name");
  }
  return name;
}

export function validateEnvironmentValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment binding value must be a string");
  }
  return value;
}

export function assertNoEnvironmentNameCollisions(names: readonly string[]): void {
  const normalizedNames = new Set<string>();
  for (const name of names) {
    const normalizedName = name.toUpperCase();
    if (normalizedNames.has(normalizedName)) {
      throw new ManagedAgentRuntimeAdmissionError("Managed environment binding names must not collide case-insensitively");
    }
    normalizedNames.add(normalizedName);
  }
}

function isReservedEnvironmentBindingName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName === "__proto__" || normalizedName === "prototype" || normalizedName === "constructor";
}
