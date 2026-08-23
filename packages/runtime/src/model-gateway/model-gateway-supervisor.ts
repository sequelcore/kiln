import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity, type ModelGatewayListenerInspection, type ModelGatewayShutdownResult } from "./model-gateway-listener.js";

export type ModelGatewayHostRuntimeKind = "bun";
export type ModelGatewayHostSource = "bundled" | "repository";

/**
 * Immutable identity of the executable host selected by the launch resolver.
 * The supervisor never discovers, downloads, or substitutes a host itself.
 */
export interface ModelGatewayHostIdentity {
  readonly schemaVersion: 1;
  readonly runtimeKind: ModelGatewayHostRuntimeKind;
  readonly version: string;
  readonly revision: string;
  readonly provenance: string;
  readonly sha256: string;
  readonly platform: string;
  readonly arch: string;
  readonly packageName: string;
  readonly source: ModelGatewayHostSource;
}

export interface ModelGatewayLaunchDescriptor {
  readonly schemaVersion: 2;
  readonly command: string;
  readonly args: readonly string[];
  readonly mode: "installed" | "local-dev";
  readonly version: string;
  readonly requiredEnvNames: readonly string[];
  readonly host: ModelGatewayHostIdentity;
}

export interface ModelGatewayRuntimeState {
  readonly schemaVersion: 2;
  readonly instanceId: string;
  readonly pid: number;
  readonly port: number;
  readonly version: string;
  readonly configDigest: string;
  readonly startedAt: string;
  readonly launch: ModelGatewayLaunchDescriptor;
}

export interface ModelGatewayProcessAdapter {
  spawn(descriptor: ModelGatewaySpawnDescriptor, env: Readonly<Record<string, string | undefined>>): Promise<{ readonly pid: number }>;
  terminate(pid: number): Promise<void>;
  isAlive(pid: number): boolean;
}

export interface ModelGatewaySpawnDescriptor {
  readonly command: string;
  readonly args: readonly string[];
  readonly detached: true;
  readonly windowsHide: true;
}

export type ModelGatewaySupervisorStatus =
  | { readonly state: "ready"; readonly identity: ModelGatewayListenerIdentity }
  | { readonly state: "foreign"; readonly reason: string }
  | { readonly state: "stopped" };

export interface ModelGatewaySupervisorDoctor {
  readonly status: ModelGatewaySupervisorStatus;
  readonly stateFile: "present" | "absent";
  readonly configDigest: string;
  readonly version: string;
  readonly host: {
    readonly desired: ModelGatewayHostIdentity;
    readonly observed: ModelGatewayHostIdentity | undefined;
  };
  readonly diagnostics: readonly string[];
}

export class ModelGatewaySupervisor {
  readonly #config: ModelGatewayConfig;
  readonly #runtimeDir: string;
  readonly #version: string;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #launch: ModelGatewayLaunchDescriptor;
  readonly #inspect: (expected?: Pick<ModelGatewayListenerIdentity, "port" | "configDigest">) => Promise<ModelGatewayListenerInspection>;
  readonly #requestShutdown: (identity: ModelGatewayListenerIdentity) => Promise<ModelGatewayShutdownResult>;
  readonly #process: ModelGatewayProcessAdapter;
  readonly #createInstanceId: () => string;
  readonly #wait: (ms: number) => Promise<void>;
  readonly #now: () => Date;

  constructor(input: {
    readonly config: ModelGatewayConfig;
    readonly runtimeDir: string;
    readonly version: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly launch: ModelGatewayLaunchDescriptor;
    readonly inspect: (expected?: Pick<ModelGatewayListenerIdentity, "port" | "configDigest">) => Promise<ModelGatewayListenerInspection>;
    readonly requestShutdown: (identity: ModelGatewayListenerIdentity) => Promise<ModelGatewayShutdownResult>;
    readonly processAdapter?: ModelGatewayProcessAdapter;
    readonly createInstanceId?: () => string;
    readonly wait?: (ms: number) => Promise<void>;
    readonly now?: () => Date;
  }) {
    this.#config = input.config;
    this.#runtimeDir = input.runtimeDir;
    this.#version = input.version;
    this.#env = input.env;
    this.#launch = validateLaunch(input.launch);
    this.#inspect = input.inspect;
    this.#requestShutdown = input.requestShutdown;
    this.#process = input.processAdapter ?? nodeModelGatewayProcessAdapter;
    this.#createInstanceId = input.createInstanceId ?? randomUUID;
    this.#wait = input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = input.now ?? (() => new Date());
    if (this.#launch.version !== this.#version) throw new Error("Model gateway launch descriptor version does not match the supervisor version.");
    const serializedLaunch = JSON.stringify(this.#launch);
    for (const name of this.#launch.requiredEnvNames) {
      const value = this.#env[name];
      if (value && serializedLaunch.includes(value)) throw new Error(`Model gateway launch descriptor must reference '${name}' by name, not value.`);
    }
  }

  async status(): Promise<ModelGatewaySupervisorStatus> {
    const state = await this.#readStoredState();
    const inspection = await this.#inspect(state ? { port: state.port, configDigest: state.configDigest } : undefined);
    if (inspection.state !== "ready") return inspection;
    if (!state || !owns(inspection.identity, state)) return { state: "foreign", reason: "unmanaged-ready-listener" };
    return inspection;
  }

  async start(): Promise<ModelGatewaySupervisorStatus> {
    return this.#withLock(async () => this.#startLocked());
  }

  async ensure(): Promise<ModelGatewaySupervisorStatus> {
    return this.start();
  }

  async stop(): Promise<ModelGatewaySupervisorStatus> {
    return this.#withLock(async () => this.#stopLocked());
  }

  async restart(): Promise<ModelGatewaySupervisorStatus> {
    return this.#withLock(async () => {
      const stopped = await this.#stopLocked();
      if (stopped.state === "foreign") return stopped;
      return this.#startLocked();
    });
  }

  async doctor(): Promise<ModelGatewaySupervisorDoctor> {
    const [status, state] = await Promise.all([this.status(), this.#readStoredState()]);
    const diagnostics: string[] = [];
    if (status.state === "foreign") diagnostics.push(`foreign-listener:${status.reason}`);
    if (state && state.configDigest !== createModelGatewayConfigDigest(this.#config)) diagnostics.push("state-config-drift");
    if (state && state.version !== this.#version) diagnostics.push("state-version-drift");
    if (state && !sameHostIdentity(state.launch.host, this.#launch.host)) diagnostics.push("state-host-drift");
    if (state && !this.#process.isAlive(state.pid) && status.state !== "ready") diagnostics.push("stale-state");
    for (const name of this.#launch.requiredEnvNames) if (!this.#env[name]) diagnostics.push(`missing-env:${name}`);
    return {
      status,
      stateFile: state ? "present" : "absent",
      configDigest: createModelGatewayConfigDigest(this.#config),
      version: this.#version,
      host: { desired: this.#launch.host, observed: state?.launch.host },
      diagnostics,
    };
  }

  async readState(): Promise<ModelGatewayRuntimeState | null> {
    return this.#readStoredState();
  }

  async #readStoredState(): Promise<ModelGatewayRuntimeState | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#statePath(), "utf8")) as unknown;
      if (isRuntimeState(parsed)) return parsed;
      throw new Error("Model gateway state is unsupported or invalid; remove state.json only after confirming no gateway process is running.");
    } catch (error) {
      if (isFsCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async #startLocked(): Promise<ModelGatewaySupervisorStatus> {
    const current = await this.status();
    if (current.state === "foreign") return current;
    if (current.state === "ready") {
      const state = await this.#readStoredState();
      if (state && isDesiredRuntime(current.identity, state, this.#config, this.#version, this.#launch)) return current;
      const stopped = await this.#stopLocked();
      if (stopped.state === "foreign") return stopped;
    }
    const stale = await this.#readStoredState();
    if (stale && this.#process.isAlive(stale.pid)) return { state: "foreign", reason: "stale-owner-alive" };
    if (stale) await this.#removeState();
    const instanceId = this.#createInstanceId();
    const args = [...this.#launch.args, "--instance-id", instanceId];
    const child = await this.#process.spawn({ command: this.#launch.command, args, detached: true, windowsHide: true }, this.#env);
    const state: ModelGatewayRuntimeState = {
      schemaVersion: 2,
      instanceId,
      pid: child.pid,
      port: this.#config.port,
      version: this.#version,
      configDigest: createModelGatewayConfigDigest(this.#config),
      startedAt: this.#now().toISOString(),
      launch: this.#launch,
    };
    await this.#writeState(state);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const inspection = await this.#inspect();
      if (inspection.state === "ready") return owns(inspection.identity, state) ? inspection : { state: "foreign", reason: "spawned-identity-mismatch" };
      if (inspection.state === "foreign") return inspection;
      await this.#wait(100);
    }
    return { state: "foreign", reason: "startup-timeout" };
  }

  async #stopLocked(): Promise<ModelGatewaySupervisorStatus> {
    const current = await this.status();
    const state = await this.#readStoredState();
    if (current.state === "foreign") return current;
    if (current.state === "stopped") {
      if (state && this.#process.isAlive(state.pid)) return { state: "foreign", reason: "stale-owner-alive" };
      if (state) await this.#removeState();
      return current;
    }
    if (!state || !owns(current.identity, state)) return { state: "foreign", reason: "ownership-mismatch" };
    const shutdown = await this.#requestShutdown(current.identity);
    if (shutdown.state === "foreign") return { state: "foreign", reason: `shutdown-${shutdown.reason}` };
    let forced = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const inspection = await this.#inspect({ port: state.port, configDigest: state.configDigest });
      if (inspection.state === "foreign") return inspection;
      if (inspection.state === "stopped" && !this.#process.isAlive(current.identity.pid)) {
        await this.#removeState();
        return inspection;
      }
      if (attempt === 39 && this.#process.isAlive(current.identity.pid)) {
        await this.#process.terminate(current.identity.pid);
        forced = true;
      }
      await this.#wait(100);
    }
    return { state: "foreign", reason: forced ? "forced-shutdown-timeout" : "shutdown-timeout" };
  }

  async #withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.#runtimeDir, { recursive: true });
    let handle;
    try {
      handle = await open(this.#lockPath(), "wx", 0o600);
    } catch (error) {
      if (!isFsCode(error, "EEXIST")) throw error;
      throw new Error("Another model gateway lifecycle operation is in progress.");
    }
    try {
      await handle.writeFile(String(process.pid), "utf8");
      return await action();
    } finally {
      await handle.close();
      await rm(this.#lockPath(), { force: true });
    }
  }

  async #writeState(state: ModelGatewayRuntimeState): Promise<void> {
    await mkdir(this.#runtimeDir, { recursive: true, mode: 0o700 });
    const temporary = `${this.#statePath()}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#statePath());
  }
  async #removeState(): Promise<void> { await rm(this.#statePath(), { force: true }); }
  #statePath(): string { return join(this.#runtimeDir, "state.json"); }
  #lockPath(): string { return join(this.#runtimeDir, "lifecycle.lock"); }
}

export const nodeModelGatewayProcessAdapter: ModelGatewayProcessAdapter = {
  async spawn(descriptor, env) {
    const child = spawn(descriptor.command, [...descriptor.args], { detached: descriptor.detached, windowsHide: descriptor.windowsHide, stdio: "ignore", env: { ...process.env, ...env } });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    if (!child.pid) throw new Error("Model gateway child did not expose a process id.");
    return { pid: child.pid };
  },
  async terminate(pid) { process.kill(pid, "SIGTERM"); },
  isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } },
};

function owns(identity: ModelGatewayListenerIdentity, state: ModelGatewayRuntimeState): boolean {
  return identity.instanceId === state.instanceId && identity.pid === state.pid && identity.port === state.port && identity.version === state.version && identity.configDigest === state.configDigest;
}

function isDesiredRuntime(
  identity: ModelGatewayListenerIdentity,
  state: ModelGatewayRuntimeState,
  config: ModelGatewayConfig,
  version: string,
  launch: ModelGatewayLaunchDescriptor,
): boolean {
  return identity.port === config.port
    && identity.configDigest === createModelGatewayConfigDigest(config)
    && identity.version === version
    && JSON.stringify(state.launch) === JSON.stringify(launch);
}

function validateLaunch(value: ModelGatewayLaunchDescriptor): ModelGatewayLaunchDescriptor {
  if (value.schemaVersion !== 2 || !value.command || !value.version || !["installed", "local-dev"].includes(value.mode) || !isHostIdentity(value.host)) throw new Error("Invalid model gateway launch descriptor.");
  if (value.requiredEnvNames.some((name) => !/^[A-Z_][A-Z0-9_]*$/.test(name))) throw new Error("Model gateway launch descriptor contains an invalid environment name.");
  return { ...value, args: [...value.args], requiredEnvNames: [...new Set(value.requiredEnvNames)].sort(), host: { ...value.host } };
}
export function validateModelGatewayHostIdentity(value: unknown): ModelGatewayHostIdentity {
  if (!isHostIdentity(value)) throw new Error("Invalid model gateway host identity.");
  return { ...value };
}

function isRuntimeState(value: unknown): value is ModelGatewayRuntimeState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ModelGatewayRuntimeState>;
  return state.schemaVersion === 2 && typeof state.instanceId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(state.instanceId) && Number.isSafeInteger(state.pid) && (state.pid ?? 0) > 0 && typeof state.configDigest === "string" && /^[a-f0-9]{64}$/.test(state.configDigest) && typeof state.version === "string" && typeof state.port === "number" && typeof state.startedAt === "string" && !!state.launch && isValidLaunch(state.launch);
}
function isValidLaunch(value: unknown): value is ModelGatewayLaunchDescriptor {
  try { validateLaunch(value as ModelGatewayLaunchDescriptor); return true; } catch { return false; }
}
function isHostIdentity(value: unknown): value is ModelGatewayHostIdentity {
  if (!value || typeof value !== "object") return false;
  const host = value as Partial<ModelGatewayHostIdentity>;
  return host.schemaVersion === 1
    && host.runtimeKind === "bun"
    && typeof host.version === "string" && host.version.length > 0
    && typeof host.revision === "string" && host.revision.length > 0
    && typeof host.provenance === "string" && host.provenance.length > 0
    && typeof host.sha256 === "string" && /^[a-f0-9]{64}$/.test(host.sha256)
    && typeof host.platform === "string" && host.platform.length > 0
    && typeof host.arch === "string" && host.arch.length > 0
    && typeof host.packageName === "string" && /^@kilnai\/[a-z0-9-]+$/.test(host.packageName)
    && (host.source === "bundled" || host.source === "repository");
}
function sameHostIdentity(left: ModelGatewayHostIdentity, right: ModelGatewayHostIdentity): boolean {
  return left.runtimeKind === right.runtimeKind && left.version === right.version && left.revision === right.revision && left.provenance === right.provenance && left.sha256 === right.sha256 && left.platform === right.platform && left.arch === right.arch && left.packageName === right.packageName && left.source === right.source;
}
function isFsCode(error: unknown, code: string): boolean { return !!error && typeof error === "object" && (error as { readonly code?: unknown }).code === code; }
