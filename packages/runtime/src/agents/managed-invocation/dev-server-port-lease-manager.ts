import { createServer } from "node:net";
import type { Server } from "node:net";
import type { ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { ManagedAgentLeaseAcquireError } from "./lease-errors.js";
import { isNodeError, toError, uniqueNumbers, uniqueStrings } from "./runtime-primitives.js";
import type {
  ManagedAgentWorktreeLeaseManagerInput as ManagedAgentDevServerPortLeaseManagerInputBase,
  ManagedAgentWorktreeLeaseReleaseInput as ManagedAgentDevServerPortLeaseReleaseInputBase,
} from "./worktree-lease-manager.js";

export type ManagedAgentDevServerPortLeaseManagerInput = ManagedAgentDevServerPortLeaseManagerInputBase;

export type ManagedAgentDevServerPortLeaseReleaseInput = ManagedAgentDevServerPortLeaseReleaseInputBase;

export interface ManagedAgentDevServerPortLeaseManager {
  acquire(input: ManagedAgentDevServerPortLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentDevServerPortLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export interface ManagedInMemoryDevServerPortLeaseManagerConfig {
  readonly ports: readonly number[];
  readonly host?: string;
}

class ManagedAgentDevServerPortLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

export class ManagedInMemoryDevServerPortLeaseManager implements ManagedAgentDevServerPortLeaseManager {
  private readonly ports: readonly number[];
  private readonly host: string;
  private readonly leases = new Map<string, number>();
  private readonly pendingPorts = new Set<number>();

  constructor(config: ManagedInMemoryDevServerPortLeaseManagerConfig) {
    this.ports = uniqueNumbers(config.ports.map(validateDevServerPort));
    if (this.ports.length === 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed dev-server port lease manager requires at least one port");
    }
    this.host = config.host ?? "127.0.0.1";
  }

  async acquire(input: ManagedAgentDevServerPortLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const port = await this.reserveAvailablePort();
    if (port === undefined) {
      throw new ManagedAgentDevServerPortLeaseAcquireError("No managed dev-server ports are available", false);
    }
    try {
      this.leases.set(input.request.invocationId, port);
      return {
        ...input.lease,
        healthStatus: "healthy",
        cleanupStatus: "pending",
        resourceUris: uniqueStrings([
          ...input.lease.resourceUris,
          devServerPortResourceUri(input.request.invocationId, port),
        ]),
      };
    } finally {
      this.pendingPorts.delete(port);
    }
  }

  async release(input: ManagedAgentDevServerPortLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const port = this.leases.get(input.request.invocationId);
    if (port === undefined) {
      return input.lease;
    }
    this.leases.delete(input.request.invocationId);
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        devServerPortReleaseUri(input.request.invocationId, port),
      ]),
    };
  }

  private async reserveAvailablePort(): Promise<number | undefined> {
    const leasedPorts = new Set(this.leases.values());
    for (const port of this.ports) {
      if (leasedPorts.has(port) || this.pendingPorts.has(port)) {
        continue;
      }
      this.pendingPorts.add(port);
      try {
        if (await canBindTcpPort(this.host, port)) {
          return port;
        }
      } catch (error) {
        this.pendingPorts.delete(port);
        throw error;
      }
      this.pendingPorts.delete(port);
    }
    return undefined;
  }
}

export function devServerPortResourceUri(invocationId: string, port: number): string {
  return `kiln://artifacts/${invocationId}/dev-server-port/${port}`;
}

export function devServerPortReleaseUri(invocationId: string, port: number): string {
  return `kiln://artifacts/${invocationId}/dev-server-port-release/${port}`;
}

export function validateDevServerPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ManagedAgentRuntimeAdmissionError("Managed dev-server port must be an integer from 1 to 65535");
  }
  return port;
}

export function readDevServerPortLeaseValue(invocationId: string, resourceUris: readonly string[]): number | undefined {
  for (let index = resourceUris.length - 1; index >= 0; index -= 1) {
    const uri = resourceUris[index]!;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") {
        continue;
      }
      const pathSegments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
      if (pathSegments.length !== 3 || pathSegments[0] !== invocationId || pathSegments[1] !== "dev-server-port") {
        continue;
      }
      return validateDevServerPort(Number(pathSegments[2]));
    } catch {
      continue;
    }
  }
  return undefined;
}

async function canBindTcpPort(host: string, port: number): Promise<boolean> {
  const server = createServer();
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const settle = async (available: boolean, error?: Error): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
      try {
        if (server.listening) {
          await closeTcpServer(server);
        }
      } catch (closeError) {
        reject(toError(closeError));
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(available);
    };
    server.once("error", (error) => {
      if (isTcpPortInUseError(error)) {
        void settle(false);
        return;
      }
      void settle(false, new ManagedAgentDevServerPortLeaseAcquireError(
        `Managed dev-server port probe failed for ${host}:${port}: ${toError(error).message}`,
        false,
      ));
    });
    server.once("listening", () => {
      void settle(true);
    });
    try {
      server.listen(port, host);
    } catch (error) {
      void settle(false, new ManagedAgentDevServerPortLeaseAcquireError(
        `Managed dev-server port probe failed for ${host}:${port}: ${toError(error).message}`,
        false,
      ));
    }
  });
}

function isTcpPortInUseError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EADDRINUSE";
}

async function closeTcpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
