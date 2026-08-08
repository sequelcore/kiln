import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OPERATOR_RUNTIME_AUDIENCE,
  OPERATOR_RUNTIME_PROTOCOL_VERSION,
  OperatorSupervisorIdentitySchema,
  type OperatorSupervisorIdentity,
} from "@kilnai/gateway-contracts";
import type { OperatorRuntimeListenerInspection } from "./operator-listener.js";

const STATE_FILE = "state.json";
const CREDENTIALS_FILE = "credentials.json";
const LIFECYCLE_LOCK_FILE = "lifecycle.lock";
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const CREDENTIAL_BYTES = 32;
const DEFAULT_STARTUP_ATTEMPTS = 50;
const DEFAULT_SHUTDOWN_ATTEMPTS = 50;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DUMMY_CONTROL_TOKEN = "operator-runtime-unavailable-control-token";
const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
const FORBIDDEN_LAUNCH_ARGUMENT = /^(?:--(?:api-?key|control-?token|credential|password|project-?root|session-?secret|token))(?:=|$)/i;

export interface OperatorRuntimeLaunchDescriptor {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly args: readonly string[];
  readonly mode: "installed" | "local-dev";
  readonly version: string;
}

export interface OperatorRuntimeState {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly pid: number;
  readonly port: number;
  readonly version: string;
  readonly startedAt: number;
  readonly launch: OperatorRuntimeLaunchDescriptor;
}

export interface OperatorRuntimeCredentialMaterial {
  readonly controlToken: string;
  readonly sessionSecret: Uint8Array;
}

export interface OperatorRuntimeChildCredentials extends OperatorRuntimeCredentialMaterial {
  readonly schemaVersion: 1;
}

export interface OperatorRuntimeBridgeCredentials {
  readonly schemaVersion: 1;
  readonly controlToken: string;
}

export interface OperatorRuntimeSpawnDescriptor {
  readonly command: string;
  readonly args: readonly string[];
  readonly detached: true;
  readonly windowsHide: true;
}

export interface OperatorRuntimeProcessAdapter {
  spawn(descriptor: OperatorRuntimeSpawnDescriptor): Promise<{ readonly pid: number }>;
  terminate(pid: number): Promise<void>;
  isAlive(pid: number): boolean;
}

export type OperatorRuntimeListenerInspector = (input: {
  readonly port: number;
  readonly controlToken: string;
  readonly expectedIdentity?: OperatorSupervisorIdentity;
}) => Promise<OperatorRuntimeListenerInspection>;

export type OperatorRuntimeSupervisorReason =
  | "unauthorized"
  | "unexpected-response"
  | "listener-identity-mismatch"
  | "unmanaged-ready-listener"
  | "stale-owner-alive"
  | "invalid-runtime-state"
  | "invalid-runtime-credentials"
  | "lifecycle-operation-in-progress"
  | "spawn-failed"
  | "state-write-failed"
  | "startup-timeout"
  | "startup-cleanup-failed"
  | "shutdown-timeout"
  | "runtime-io-failed";

export type OperatorRuntimeSupervisorStatus =
  | { readonly state: "ready"; readonly identity: OperatorSupervisorIdentity }
  | { readonly state: "foreign"; readonly reason: OperatorRuntimeSupervisorReason }
  | { readonly state: "stopped" };

export interface OperatorRuntimeSupervisorDoctor {
  readonly status: OperatorRuntimeSupervisorStatus;
  readonly stateFile: "present" | "absent" | "invalid";
  readonly credentialsFile: "present" | "absent" | "invalid";
  readonly version: string;
  readonly port: number;
  readonly diagnostics: readonly OperatorRuntimeSupervisorReason[];
}

type FileSnapshot<T> =
  | { readonly state: "present"; readonly value: T }
  | { readonly state: "absent" }
  | { readonly state: "invalid" };

/** Owns exactly one machine-global operator runtime process for one runtime directory. */
export class OperatorRuntimeSupervisor {
  readonly #runtimeDir: string;
  readonly #port: number;
  readonly #version: string;
  readonly #launch: OperatorRuntimeLaunchDescriptor;
  readonly #inspect: OperatorRuntimeListenerInspector;
  readonly #process: OperatorRuntimeProcessAdapter;
  readonly #createInstanceId: () => string;
  readonly #createCredentialMaterial: () => OperatorRuntimeCredentialMaterial;
  readonly #nowEpochSeconds: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #startupAttempts: number;
  readonly #shutdownAttempts: number;
  readonly #pollIntervalMs: number;
  #ensureInFlight: Promise<OperatorRuntimeSupervisorStatus> | undefined;

  constructor(input: {
    readonly runtimeDir: string;
    readonly port: number;
    readonly version: string;
    readonly launch: OperatorRuntimeLaunchDescriptor;
    readonly inspect: OperatorRuntimeListenerInspector;
    readonly processAdapter?: OperatorRuntimeProcessAdapter;
    readonly createInstanceId?: () => string;
    readonly createCredentialMaterial?: () => OperatorRuntimeCredentialMaterial;
    readonly nowEpochSeconds?: () => number;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly startupAttempts?: number;
    readonly shutdownAttempts?: number;
    readonly pollIntervalMs?: number;
  }) {
    if (!input.runtimeDir.trim()) throw new Error("Operator runtime directory must not be empty.");
    if (!Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65_535) {
      throw new Error("Operator runtime port must be an explicit valid TCP port.");
    }
    if (!VERSION.test(input.version)) throw new Error("Operator runtime version is invalid.");
    this.#runtimeDir = input.runtimeDir;
    this.#port = input.port;
    this.#version = input.version;
    this.#launch = parseLaunch(input.launch);
    if (this.#launch.version !== this.#version) {
      throw new Error("Operator runtime launch descriptor version does not match the supervisor version.");
    }
    this.#inspect = input.inspect;
    this.#process = input.processAdapter ?? nodeOperatorRuntimeProcessAdapter;
    this.#createInstanceId = input.createInstanceId ?? randomUUID;
    this.#createCredentialMaterial = input.createCredentialMaterial ?? createRandomCredentialMaterial;
    this.#nowEpochSeconds = input.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1_000));
    this.#wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#startupAttempts = requirePositiveAttempts(input.startupAttempts ?? DEFAULT_STARTUP_ATTEMPTS, "startup");
    this.#shutdownAttempts = requirePositiveAttempts(input.shutdownAttempts ?? DEFAULT_SHUTDOWN_ATTEMPTS, "shutdown");
    this.#pollIntervalMs = requireNonNegativeInteger(input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, "poll interval");
  }

  async status(): Promise<OperatorRuntimeSupervisorStatus> {
    try {
      const state = await readStateSnapshot(this.#runtimeDir);
      const credentials = await readCredentialSnapshot(this.#runtimeDir);
      if (state.state === "invalid") return foreign("invalid-runtime-state");
      if (credentials.state === "invalid") return foreign("invalid-runtime-credentials");
      const expectedIdentity = state.state === "present" ? identityFromState(state.value) : undefined;
      const inspection = await this.#inspect({
        port: this.#port,
        controlToken: credentials.state === "present" ? credentials.value.controlToken : DUMMY_CONTROL_TOKEN,
        ...(expectedIdentity === undefined ? {} : { expectedIdentity }),
      });
      if (inspection.state === "stopped") return inspection;
      if (inspection.state === "foreign") return foreign(mapInspectionReason(inspection.reason));
      if (!expectedIdentity) return foreign("unmanaged-ready-listener");
      return identitiesEqual(inspection.identity, expectedIdentity)
        ? inspection
        : foreign("listener-identity-mismatch");
    } catch {
      return foreign("runtime-io-failed");
    }
  }

  async start(): Promise<OperatorRuntimeSupervisorStatus> {
    return this.#withLock(() => this.#startLocked());
  }

  ensure(): Promise<OperatorRuntimeSupervisorStatus> {
    if (this.#ensureInFlight) return this.#ensureInFlight;
    const operation = this.start().finally(() => {
      if (this.#ensureInFlight === operation) this.#ensureInFlight = undefined;
    });
    this.#ensureInFlight = operation;
    return operation;
  }

  async stop(): Promise<OperatorRuntimeSupervisorStatus> {
    return this.#withLock(() => this.#stopLocked());
  }

  async restart(): Promise<OperatorRuntimeSupervisorStatus> {
    return this.#withLock(async () => {
      const stopped = await this.#stopLocked();
      if (stopped.state === "foreign") return stopped;
      return this.#startLocked();
    });
  }

  async doctor(): Promise<OperatorRuntimeSupervisorDoctor> {
    const diagnostics: OperatorRuntimeSupervisorReason[] = [];
    const [state, credentials, status] = await Promise.all([
      readStateSnapshot(this.#runtimeDir).catch(() => ({ state: "invalid" as const })),
      readCredentialSnapshot(this.#runtimeDir).catch(() => ({ state: "invalid" as const })),
      this.status(),
    ]);
    if (state.state === "invalid") diagnostics.push("invalid-runtime-state");
    if (credentials.state === "invalid") diagnostics.push("invalid-runtime-credentials");
    if (status.state === "foreign" && !diagnostics.includes(status.reason)) diagnostics.push(status.reason);
    if (state.state === "present" && status.state === "stopped" && this.#process.isAlive(state.value.pid)) {
      diagnostics.push("stale-owner-alive");
    }
    return {
      status,
      stateFile: state.state,
      credentialsFile: credentials.state,
      version: this.#version,
      port: this.#port,
      diagnostics,
    };
  }

  async readState(): Promise<OperatorRuntimeState | null> {
    const snapshot = await readStateSnapshot(this.#runtimeDir);
    if (snapshot.state === "invalid") throw new Error("Operator runtime state is invalid.");
    return snapshot.state === "present" ? snapshot.value : null;
  }

  async #startLocked(): Promise<OperatorRuntimeSupervisorStatus> {
    const current = await this.status();
    if (current.state !== "stopped") return current;
    const stale = await readStateSnapshot(this.#runtimeDir);
    if (stale.state === "invalid") return foreign("invalid-runtime-state");
    if (stale.state === "present" && this.#process.isAlive(stale.value.pid)) return foreign("stale-owner-alive");
    await this.#removeOwnedFiles();

    let instanceId: string;
    let startedAt: number;
    let credentials: OperatorRuntimeChildCredentials;
    try {
      instanceId = requirePortableId(this.#createInstanceId(), "instance id");
      startedAt = requireEpochSeconds(this.#nowEpochSeconds());
      credentials = normalizeCredentials(this.#createCredentialMaterial());
      await writeCredentialsAtomic(this.#runtimeDir, credentials);
    } catch {
      await this.#removeOwnedFiles().catch(() => undefined);
      return foreign("runtime-io-failed");
    }

    let child: { readonly pid: number };
    try {
      child = await this.#process.spawn({
        command: this.#launch.command,
        args: [...this.#launch.args, "--instance-id", instanceId, "--started-at", String(startedAt)],
        detached: true,
        windowsHide: true,
      });
      requirePid(child.pid);
    } catch {
      await this.#removeOwnedFiles().catch(() => undefined);
      return foreign("spawn-failed");
    }

    const state: OperatorRuntimeState = {
      schemaVersion: 1,
      instanceId,
      pid: child.pid,
      port: this.#port,
      version: this.#version,
      startedAt,
      launch: this.#launch,
    };
    try {
      await writeStateAtomic(this.#runtimeDir, state);
    } catch {
      const cleaned = await this.#terminateSpawnedAndRemove(child.pid);
      return foreign(cleaned ? "state-write-failed" : "startup-cleanup-failed");
    }

    const expectedIdentity = identityFromState(state);
    for (let attempt = 0; attempt < this.#startupAttempts; attempt += 1) {
      const inspection = await this.#inspect({ port: this.#port, controlToken: credentials.controlToken, expectedIdentity });
      if (inspection.state === "ready") {
        if (identitiesEqual(inspection.identity, expectedIdentity)) return inspection;
        const cleaned = await this.#terminateSpawnedAndRemove(child.pid);
        return foreign(cleaned ? "listener-identity-mismatch" : "startup-cleanup-failed");
      }
      if (inspection.state === "foreign") {
        const cleaned = await this.#terminateSpawnedAndRemove(child.pid);
        return foreign(cleaned ? mapInspectionReason(inspection.reason) : "startup-cleanup-failed");
      }
      if (attempt + 1 < this.#startupAttempts) await this.#wait(this.#pollIntervalMs);
    }
    const cleaned = await this.#terminateSpawnedAndRemove(child.pid);
    return foreign(cleaned ? "startup-timeout" : "startup-cleanup-failed");
  }

  async #stopLocked(): Promise<OperatorRuntimeSupervisorStatus> {
    const current = await this.status();
    const state = await readStateSnapshot(this.#runtimeDir);
    if (state.state === "invalid") return foreign("invalid-runtime-state");
    if (current.state === "foreign") return current;
    if (current.state === "stopped") {
      if (state.state === "present" && this.#process.isAlive(state.value.pid)) return foreign("stale-owner-alive");
      await this.#removeOwnedFiles();
      return current;
    }
    if (state.state !== "present" || !identitiesEqual(current.identity, identityFromState(state.value))) {
      return foreign("listener-identity-mismatch");
    }
    await this.#process.terminate(state.value.pid);
    const credentials = await readCredentialSnapshot(this.#runtimeDir);
    if (credentials.state !== "present") return foreign("invalid-runtime-credentials");
    for (let attempt = 0; attempt < this.#shutdownAttempts; attempt += 1) {
      const inspection = await this.#inspect({
        port: this.#port,
        controlToken: credentials.value.controlToken,
        expectedIdentity: current.identity,
      });
      if (inspection.state === "stopped") {
        if (!this.#process.isAlive(state.value.pid)) {
          await this.#removeOwnedFiles();
          return inspection;
        }
        if (attempt + 1 < this.#shutdownAttempts) await this.#wait(this.#pollIntervalMs);
        continue;
      }
      if (inspection.state === "foreign") return foreign(mapInspectionReason(inspection.reason));
      if (!identitiesEqual(inspection.identity, current.identity)) return foreign("listener-identity-mismatch");
      if (attempt + 1 < this.#shutdownAttempts) await this.#wait(this.#pollIntervalMs);
    }
    return foreign("shutdown-timeout");
  }

  async #withLock(action: () => Promise<OperatorRuntimeSupervisorStatus>): Promise<OperatorRuntimeSupervisorStatus> {
    try {
      await ensureRuntimeDirectory(this.#runtimeDir);
      let handle;
      try {
        handle = await open(join(this.#runtimeDir, LIFECYCLE_LOCK_FILE), "wx", FILE_MODE);
      } catch (error) {
        return isFsCode(error, "EEXIST")
          ? foreign("lifecycle-operation-in-progress")
          : foreign("runtime-io-failed");
      }
      try {
        await handle.writeFile(`${process.pid}\n`, "utf8");
        return await action();
      } catch {
        return foreign("runtime-io-failed");
      } finally {
        await handle.close().catch(() => undefined);
        await rm(join(this.#runtimeDir, LIFECYCLE_LOCK_FILE), { force: true }).catch(() => undefined);
      }
    } catch {
      return foreign("runtime-io-failed");
    }
  }

  async #terminateSpawnedAndRemove(pid: number): Promise<boolean> {
    try {
      await this.#process.terminate(pid);
      for (let attempt = 0; attempt < this.#shutdownAttempts; attempt += 1) {
        if (!this.#process.isAlive(pid)) {
          await this.#removeOwnedFiles();
          return true;
        }
        if (attempt + 1 < this.#shutdownAttempts) await this.#wait(this.#pollIntervalMs);
      }
      return false;
    } catch {
      return false;
    }
  }

  async #removeOwnedFiles(): Promise<void> {
    await Promise.all([
      rm(join(this.#runtimeDir, STATE_FILE), { force: true }),
      rm(join(this.#runtimeDir, CREDENTIALS_FILE), { force: true }),
    ]);
  }
}

export async function readOperatorRuntimeChildCredentials(runtimeDir: string): Promise<OperatorRuntimeChildCredentials | null> {
  const snapshot = await readCredentialSnapshot(runtimeDir);
  if (snapshot.state === "invalid") throw new Error("Operator runtime credentials are invalid.");
  if (snapshot.state === "absent") return null;
  return {
    schemaVersion: 1,
    controlToken: snapshot.value.controlToken,
    sessionSecret: new Uint8Array(snapshot.value.sessionSecret),
  };
}

/** Bridge-safe view: session credential signing authority never crosses this API. */
export async function readOperatorRuntimeBridgeCredentials(runtimeDir: string): Promise<OperatorRuntimeBridgeCredentials | null> {
  const credentials = await readOperatorRuntimeChildCredentials(runtimeDir);
  return credentials ? { schemaVersion: 1, controlToken: credentials.controlToken } : null;
}

export const nodeOperatorRuntimeProcessAdapter: OperatorRuntimeProcessAdapter = {
  async spawn(descriptor) {
    const child = spawn(descriptor.command, [...descriptor.args], {
      detached: descriptor.detached,
      windowsHide: descriptor.windowsHide,
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    if (!child.pid) throw new Error("Operator runtime child did not expose a process id.");
    return { pid: child.pid };
  },
  async terminate(pid) {
    process.kill(pid, "SIGTERM");
  },
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

function createRandomCredentialMaterial(): OperatorRuntimeCredentialMaterial {
  return {
    controlToken: randomBytes(CREDENTIAL_BYTES).toString("base64url"),
    sessionSecret: randomBytes(CREDENTIAL_BYTES),
  };
}

async function readStateSnapshot(runtimeDir: string): Promise<FileSnapshot<OperatorRuntimeState>> {
  const text = await readOptionalText(join(runtimeDir, STATE_FILE));
  if (text === null) return { state: "absent" };
  try {
    return { state: "present", value: parseState(JSON.parse(text) as unknown) };
  } catch {
    return { state: "invalid" };
  }
}

async function readCredentialSnapshot(runtimeDir: string): Promise<FileSnapshot<OperatorRuntimeChildCredentials>> {
  const text = await readOptionalText(join(runtimeDir, CREDENTIALS_FILE));
  if (text === null) return { state: "absent" };
  try {
    const parsed = JSON.parse(text) as unknown;
    const credentials = parseCredentialFile(parsed);
    if (text !== serializeCredentials(credentials)) return { state: "invalid" };
    return { state: "present", value: credentials };
  } catch {
    return { state: "invalid" };
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isFsCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function writeStateAtomic(runtimeDir: string, state: OperatorRuntimeState): Promise<void> {
  await atomicWrite(runtimeDir, STATE_FILE, `${JSON.stringify(parseState(state), null, 2)}\n`);
}

async function writeCredentialsAtomic(runtimeDir: string, credentials: OperatorRuntimeChildCredentials): Promise<void> {
  await atomicWrite(runtimeDir, CREDENTIALS_FILE, serializeCredentials(credentials));
}

async function atomicWrite(runtimeDir: string, fileName: string, contents: string): Promise<void> {
  await ensureRuntimeDirectory(runtimeDir);
  const target = join(runtimeDir, fileName);
  const temporary = join(runtimeDir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: FILE_MODE, flag: "wx" });
    await chmod(temporary, FILE_MODE);
    await rename(temporary, target);
    await chmod(target, FILE_MODE);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function ensureRuntimeDirectory(runtimeDir: string): Promise<void> {
  await mkdir(runtimeDir, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(runtimeDir, DIRECTORY_MODE);
}

function parseState(value: unknown): OperatorRuntimeState {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["schemaVersion", "instanceId", "pid", "port", "version", "startedAt", "launch"])) {
    throw new Error("invalid state");
  }
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1) throw new Error("invalid state");
  const result: OperatorRuntimeState = {
    schemaVersion: 1,
    instanceId: requirePortableId(state.instanceId, "instance id"),
    pid: requirePid(state.pid),
    port: requirePort(state.port),
    version: requireVersion(state.version),
    startedAt: requireEpochSeconds(state.startedAt),
    launch: parseLaunch(state.launch),
  };
  if (result.launch.version !== result.version) throw new Error("invalid state");
  return result;
}

function parseLaunch(value: unknown): OperatorRuntimeLaunchDescriptor {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["schemaVersion", "command", "args", "mode", "version"])) {
    throw new Error("Invalid operator runtime launch descriptor.");
  }
  const launch = value as Record<string, unknown>;
  if (
    launch.schemaVersion !== 1 ||
    typeof launch.command !== "string" ||
    launch.command.length < 1 ||
    launch.command.length > 4_096 ||
    (launch.mode !== "installed" && launch.mode !== "local-dev") ||
    !Array.isArray(launch.args) ||
    launch.args.length > 128 ||
    launch.args.some((argument) => typeof argument !== "string" || argument.length > 4_096) ||
    launch.args.some((argument) => typeof argument === "string" && FORBIDDEN_LAUNCH_ARGUMENT.test(argument)) ||
    launch.args.includes("--instance-id") ||
    launch.args.includes("--started-at")
  ) {
    throw new Error("Invalid operator runtime launch descriptor.");
  }
  return {
    schemaVersion: 1,
    command: launch.command,
    args: [...launch.args] as string[],
    mode: launch.mode,
    version: requireVersion(launch.version),
  };
}

function parseCredentialFile(value: unknown): OperatorRuntimeChildCredentials {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["schemaVersion", "controlToken", "sessionSecret"])) {
    throw new Error("invalid credentials");
  }
  if (value.schemaVersion !== 1 || typeof value.controlToken !== "string" || typeof value.sessionSecret !== "string") {
    throw new Error("invalid credentials");
  }
  if (!isCanonicalBase64Url32(value.controlToken) || !isCanonicalBase64Url32(value.sessionSecret)) {
    throw new Error("invalid credentials");
  }
  return {
    schemaVersion: 1,
    controlToken: value.controlToken,
    sessionSecret: new Uint8Array(Buffer.from(value.sessionSecret, "base64url")),
  };
}

function normalizeCredentials(value: OperatorRuntimeCredentialMaterial): OperatorRuntimeChildCredentials {
  if (!value || typeof value.controlToken !== "string" || !(value.sessionSecret instanceof Uint8Array)) {
    throw new Error("invalid credentials");
  }
  const encodedSecret = Buffer.from(value.sessionSecret).toString("base64url");
  return parseCredentialFile({ schemaVersion: 1, controlToken: value.controlToken, sessionSecret: encodedSecret });
}

function serializeCredentials(value: OperatorRuntimeChildCredentials): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    controlToken: value.controlToken,
    sessionSecret: Buffer.from(value.sessionSecret).toString("base64url"),
  })}\n`;
}

function identityFromState(state: OperatorRuntimeState): OperatorSupervisorIdentity {
  return OperatorSupervisorIdentitySchema.parse({
    protocolVersion: OPERATOR_RUNTIME_PROTOCOL_VERSION,
    service: OPERATOR_RUNTIME_AUDIENCE,
    instanceId: state.instanceId,
    version: state.version,
    pid: state.pid,
    startedAt: state.startedAt,
    port: state.port,
  });
}

function identitiesEqual(left: OperatorSupervisorIdentity, right: OperatorSupervisorIdentity): boolean {
  return left.protocolVersion === right.protocolVersion
    && left.service === right.service
    && left.instanceId === right.instanceId
    && left.version === right.version
    && left.pid === right.pid
    && left.startedAt === right.startedAt
    && left.port === right.port;
}

function mapInspectionReason(reason: "unauthorized" | "identity-mismatch" | "unexpected-response"): OperatorRuntimeSupervisorReason {
  return reason === "identity-mismatch" ? "listener-identity-mismatch" : reason;
}

function foreign(reason: OperatorRuntimeSupervisorReason): OperatorRuntimeSupervisorStatus {
  return { state: "foreign", reason };
}

function requirePortableId(value: unknown, name: string): string {
  if (typeof value !== "string" || !PORTABLE_ID.test(value)) throw new Error(`Invalid operator runtime ${name}.`);
  return value;
}

function requireVersion(value: unknown): string {
  if (typeof value !== "string" || !VERSION.test(value)) throw new Error("Invalid operator runtime version.");
  return value;
}

function requirePid(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error("Invalid operator runtime process id.");
  return value as number;
}

function requirePort(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) throw new Error("Invalid operator runtime port.");
  return value as number;
}

function requireEpochSeconds(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid operator runtime timestamp.");
  return value as number;
}

function requirePositiveAttempts(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error(`Operator runtime ${name} attempts are invalid.`);
  return value;
}

function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) throw new Error(`Operator runtime ${name} is invalid.`);
  return value;
}

function isCanonicalBase64Url32(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").byteLength === CREDENTIAL_BYTES;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isFsCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && (error as { readonly code?: unknown }).code === code;
}
