import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppGatewayRuntimeIdentitySchema,
  type AppGatewayRuntimeIdentity,
} from "@kilnai/gateway-contracts";
import type {
  AppGatewayListenerInspection,
  AppGatewayShutdownResult,
} from "./app-gateway-control.js";
import type { GatewayConfigurationRevision } from "./gateway-configuration-source.js";

export interface AppGatewayLaunchDescriptor {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly mode: "installed" | "local-dev";
  readonly version: string;
}

export interface AppGatewayRuntimeState extends AppGatewayRuntimeIdentity {
  readonly schemaVersion: 1;
  readonly launch: AppGatewayLaunchDescriptor;
}

export interface AppGatewayChildCredentials {
  readonly schemaVersion: 1;
  readonly controlToken: string;
}

export interface AppGatewaySpawnDescriptor {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly detached: true;
  readonly windowsHide: true;
}

export interface AppGatewayProcessAdapter {
  readonly spawn: (descriptor: AppGatewaySpawnDescriptor) => Promise<{ readonly pid: number }>;
  readonly terminate: (pid: number) => Promise<void>;
  readonly isAlive: (pid: number) => boolean;
}

export type AppGatewaySupervisorStatus =
  | { readonly state: "ready"; readonly identity: AppGatewayRuntimeIdentity }
  | { readonly state: "stopped" }
  | { readonly state: "foreign"; readonly reason: string };

export interface AppGatewaySupervisorDoctor {
  readonly status: AppGatewaySupervisorStatus;
  readonly stateFile: "present" | "absent";
  readonly credentialFile: "present" | "absent";
  readonly desired: { readonly port: number; readonly configurationRevision: GatewayConfigurationRevision };
  readonly diagnostics: readonly string[];
}

type ExpectedIdentity = Partial<Omit<AppGatewayRuntimeIdentity, "lifecycle">>;

export class AppGatewaySupervisor {
  readonly #runtimeDir: string;
  readonly #desired: { readonly port: number; readonly configurationRevision: GatewayConfigurationRevision };
  readonly #version: string;
  readonly #launch: AppGatewayLaunchDescriptor;
  readonly #inspect: (controlToken: string, expected?: ExpectedIdentity) => Promise<AppGatewayListenerInspection>;
  readonly #requestShutdown: (identity: AppGatewayRuntimeIdentity, controlToken: string) => Promise<AppGatewayShutdownResult>;
  readonly #process: AppGatewayProcessAdapter;
  readonly #createInstanceId: () => string;
  readonly #createControlToken: () => string;
  readonly #now: () => number;
  readonly #wait: (ms: number) => Promise<void>;

  constructor(input: {
    readonly runtimeDir: string;
    readonly desired: { readonly port: number; readonly configurationRevision: GatewayConfigurationRevision };
    readonly version: string;
    readonly launch: AppGatewayLaunchDescriptor;
    readonly inspect: (controlToken: string, expected?: ExpectedIdentity) => Promise<AppGatewayListenerInspection>;
    readonly requestShutdown: (identity: AppGatewayRuntimeIdentity, controlToken: string) => Promise<AppGatewayShutdownResult>;
    readonly processAdapter?: AppGatewayProcessAdapter;
    readonly createInstanceId?: () => string;
    readonly createControlToken?: () => string;
    readonly now?: () => number;
    readonly wait?: (ms: number) => Promise<void>;
  }) {
    this.#runtimeDir = input.runtimeDir;
    this.#desired = input.desired;
    this.#version = input.version;
    this.#launch = validateLaunch(input.launch);
    this.#inspect = input.inspect;
    this.#requestShutdown = input.requestShutdown;
    this.#process = input.processAdapter ?? nodeAppGatewayProcessAdapter;
    this.#createInstanceId = input.createInstanceId ?? randomUUID;
    this.#createControlToken = input.createControlToken ?? (() => randomBytes(32).toString("base64url"));
    this.#now = input.now ?? (() => Date.now());
    this.#wait = input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (this.#launch.version !== this.#version) {
      throw new Error("App Gateway launch descriptor version does not match the supervisor version.");
    }
  }

  async status(): Promise<AppGatewaySupervisorStatus> {
    const state = await this.#readStoredState();
    const credentials = await this.#readStoredCredentials(state !== null);
    const token = credentials?.controlToken ?? `unowned-probe-${this.#createControlToken()}`;
    const inspection = await this.#inspect(token, state ? expectedIdentity(state) : this.#desired);
    if (inspection.state !== "ready") return inspection;
    if (!state || !owns(inspection.identity, state)) {
      return { state: "foreign", reason: "unmanaged-ready-listener" };
    }
    return inspection;
  }

  async start(): Promise<AppGatewaySupervisorStatus> {
    return this.#withLock(() => this.#startLocked());
  }

  async ensure(): Promise<AppGatewaySupervisorStatus> {
    return this.start();
  }

  async stop(): Promise<AppGatewaySupervisorStatus> {
    return this.#withLock(() => this.#stopLocked());
  }

  async restart(): Promise<AppGatewaySupervisorStatus> {
    return this.#withLock(async () => {
      const stopped = await this.#stopLocked();
      if (stopped.state === "foreign") return stopped;
      return this.#startLocked();
    });
  }

  async doctor(): Promise<AppGatewaySupervisorDoctor> {
    const [status, state, credentials] = await Promise.all([
      this.status(),
      this.#readStoredState(),
      this.#readStoredCredentials(false),
    ]);
    const diagnostics: string[] = [];
    if (status.state === "foreign") diagnostics.push(`foreign-listener:${status.reason}`);
    if (state && state.configurationRevision !== this.#desired.configurationRevision) diagnostics.push("state-configuration-drift");
    if (state && state.port !== this.#desired.port) diagnostics.push("state-port-drift");
    if (state && state.version !== this.#version) diagnostics.push("state-version-drift");
    if (state && !sameLaunch(state.launch, this.#launch)) diagnostics.push("state-launch-drift");
    if (state && !this.#process.isAlive(state.pid) && status.state !== "ready") diagnostics.push("stale-state");
    if (state && !credentials) diagnostics.push("missing-credentials");
    return {
      status,
      stateFile: state ? "present" : "absent",
      credentialFile: credentials ? "present" : "absent",
      desired: this.#desired,
      diagnostics,
    };
  }

  async readState(): Promise<AppGatewayRuntimeState | null> {
    return this.#readStoredState();
  }

  async #startLocked(): Promise<AppGatewaySupervisorStatus> {
    const current = await this.status();
    if (current.state === "foreign") return current;
    if (current.state === "ready") {
      const state = await this.#readStoredState();
      if (state && isDesired(state, this.#desired, this.#version, this.#launch)) return current;
      const stopped = await this.#stopLocked();
      if (stopped.state === "foreign") return stopped;
    }
    const stale = await this.#readStoredState();
    if (stale && this.#process.isAlive(stale.pid)) return { state: "foreign", reason: "stale-owner-alive" };
    await this.#removeRuntimeFiles();

    const instanceId = this.#createInstanceId();
    const startedAt = this.#now();
    const credentials: AppGatewayChildCredentials = { schemaVersion: 1, controlToken: this.#createControlToken() };
    await this.#writeCredentials(credentials);
    let child: { readonly pid: number };
    try {
      child = await this.#process.spawn({
        command: this.#launch.command,
        args: [
          ...this.#launch.args,
          "--supervised-runtime",
          this.#runtimeDir,
          "--instance-id",
          instanceId,
          "--started-at",
          String(startedAt),
        ],
        cwd: this.#launch.cwd,
        detached: true,
        windowsHide: true,
      });
    } catch (error) {
      await this.#removeRuntimeFiles();
      throw error;
    }
    const state: AppGatewayRuntimeState = {
      schemaVersion: 1,
      protocolVersion: "1",
      service: "kiln-app-gateway",
      instanceId,
      version: this.#version,
      pid: child.pid,
      startedAt,
      port: this.#desired.port,
      configurationRevision: this.#desired.configurationRevision,
      lifecycle: "ready",
      launch: this.#launch,
    };
    try {
      await this.#writeState(state);
    } catch (error) {
      await this.#process.terminate(child.pid).catch(() => undefined);
      await this.#removeRuntimeFiles();
      throw error;
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const inspection = await this.#inspect(credentials.controlToken, expectedIdentity(state));
      if (inspection.state === "ready") {
        return owns(inspection.identity, state)
          ? inspection
          : { state: "foreign", reason: "spawned-identity-mismatch" };
      }
      if (inspection.state === "foreign") return inspection;
      await this.#wait(100);
    }
    return { state: "foreign", reason: "startup-timeout" };
  }

  async #stopLocked(): Promise<AppGatewaySupervisorStatus> {
    const current = await this.status();
    const state = await this.#readStoredState();
    if (current.state === "foreign") return current;
    if (current.state === "stopped") {
      if (state && this.#process.isAlive(state.pid)) return { state: "foreign", reason: "stale-owner-alive" };
      if (state) await this.#removeRuntimeFiles();
      return current;
    }
    const credentials = await this.#readStoredCredentials(true);
    if (!state || !credentials || !owns(current.identity, state)) {
      return { state: "foreign", reason: "ownership-mismatch" };
    }
    const shutdown = await this.#requestShutdown(current.identity, credentials.controlToken);
    if (shutdown.state === "foreign") return { state: "foreign", reason: `shutdown-${shutdown.reason}` };
    let forced = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const inspection = await this.#inspect(credentials.controlToken, expectedIdentity(state));
      if (inspection.state === "foreign") return inspection;
      if (inspection.state === "stopped" && !this.#process.isAlive(state.pid)) {
        await this.#removeRuntimeFiles();
        return inspection;
      }
      if (attempt === 39 && this.#process.isAlive(state.pid)) {
        await this.#process.terminate(state.pid);
        forced = true;
      }
      await this.#wait(100);
    }
    return { state: "foreign", reason: forced ? "forced-shutdown-timeout" : "shutdown-timeout" };
  }

  async #readStoredState(): Promise<AppGatewayRuntimeState | null> {
    return readAppGatewayRuntimeState(this.#runtimeDir);
  }

  async #readStoredCredentials(required: boolean): Promise<AppGatewayChildCredentials | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#credentialsPath(), "utf8"));
      if (isCredentials(value)) return value;
      throw new Error("App Gateway credentials are unsupported or invalid.");
    } catch (error) {
      if (isFsCode(error, "ENOENT") && !required) return null;
      throw error;
    }
  }

  async #withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.#runtimeDir, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await open(this.#lockPath(), "wx", 0o600);
    } catch (error) {
      if (!isFsCode(error, "EEXIST")) throw error;
      throw new Error("Another App Gateway lifecycle operation is in progress.");
    }
    try {
      await handle.writeFile(String(process.pid), "utf8");
      return await action();
    } finally {
      await handle.close();
      await rm(this.#lockPath(), { force: true });
    }
  }

  async #writeState(state: AppGatewayRuntimeState): Promise<void> {
    await this.#writeAtomic(this.#statePath(), state);
  }

  async #writeCredentials(credentials: AppGatewayChildCredentials): Promise<void> {
    await this.#writeAtomic(this.#credentialsPath(), credentials);
  }

  async #writeAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(this.#runtimeDir, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }

  async #removeRuntimeFiles(): Promise<void> {
    await Promise.all([rm(this.#statePath(), { force: true }), rm(this.#credentialsPath(), { force: true })]);
  }

  #statePath(): string { return join(this.#runtimeDir, "state.json"); }
  #credentialsPath(): string { return join(this.#runtimeDir, "credentials.json"); }
  #lockPath(): string { return join(this.#runtimeDir, "lifecycle.lock"); }
}

export async function readAppGatewayChildCredentials(runtimeDir: string): Promise<AppGatewayChildCredentials> {
  const value: unknown = JSON.parse(await readFile(join(runtimeDir, "credentials.json"), "utf8"));
  if (!isCredentials(value)) throw new Error("App Gateway credentials are unsupported or invalid.");
  return value;
}

export async function readAppGatewayRuntimeState(runtimeDir: string): Promise<AppGatewayRuntimeState | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(runtimeDir, "state.json"), "utf8"));
    if (isRuntimeState(value)) return value;
    throw new Error("App Gateway state is unsupported or invalid; remove state.json only after confirming no gateway process is running.");
  } catch (error) {
    if (isFsCode(error, "ENOENT")) return null;
    throw error;
  }
}

export const nodeAppGatewayProcessAdapter: AppGatewayProcessAdapter = {
  async spawn(descriptor) {
    const child = spawn(descriptor.command, [...descriptor.args], {
      cwd: descriptor.cwd,
      detached: descriptor.detached,
      windowsHide: descriptor.windowsHide,
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    if (!child.pid) throw new Error("App Gateway child did not expose a process id.");
    return { pid: child.pid };
  },
  async terminate(pid) { process.kill(pid, "SIGTERM"); },
  isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
  },
};

function expectedIdentity(state: AppGatewayRuntimeState): ExpectedIdentity {
  const { lifecycle: _lifecycle, launch: _launch, schemaVersion: _schemaVersion, ...identity } = state;
  return identity;
}

function owns(identity: AppGatewayRuntimeIdentity, state: AppGatewayRuntimeState): boolean {
  return Object.entries(expectedIdentity(state)).every(([key, value]) => identity[key as keyof AppGatewayRuntimeIdentity] === value);
}

function isDesired(
  state: AppGatewayRuntimeState,
  desired: { readonly port: number; readonly configurationRevision: GatewayConfigurationRevision },
  version: string,
  launch: AppGatewayLaunchDescriptor,
): boolean {
  return state.port === desired.port
    && state.configurationRevision === desired.configurationRevision
    && state.version === version
    && sameLaunch(state.launch, launch);
}

function sameLaunch(left: AppGatewayLaunchDescriptor, right: AppGatewayLaunchDescriptor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateLaunch(value: AppGatewayLaunchDescriptor): AppGatewayLaunchDescriptor {
  if (value.schemaVersion !== 1 || !value.command || !value.cwd || !value.version || !["installed", "local-dev"].includes(value.mode)) {
    throw new Error("Invalid App Gateway launch descriptor.");
  }
  return { ...value, args: [...value.args] };
}

function isRuntimeState(value: unknown): value is AppGatewayRuntimeState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppGatewayRuntimeState>;
  if (candidate.schemaVersion !== 1 || !candidate.launch) return false;
  if (!Number.isSafeInteger(candidate.startedAt) || (candidate.startedAt ?? -1) < 0) return false;
  if (!isValidLaunch(candidate.launch)) return false;
  const { schemaVersion: _schemaVersion, launch: _launch, ...identity } = candidate;
  return AppGatewayRuntimeIdentitySchema.safeParse(identity).success;
}

function isValidLaunch(value: unknown): value is AppGatewayLaunchDescriptor {
  try { validateLaunch(value as AppGatewayLaunchDescriptor); return true; } catch { return false; }
}

function isCredentials(value: unknown): value is AppGatewayChildCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppGatewayChildCredentials>;
  return candidate.schemaVersion === 1
    && typeof candidate.controlToken === "string"
    && candidate.controlToken.length >= 16
    && Object.keys(candidate).length === 2;
}

function isFsCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
