import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, win32 } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { validateModelGatewayHostIdentity, type ModelGatewayLaunchDescriptor } from "./model-gateway-supervisor.js";

const OWNERSHIP_PREFIX = "kiln:model-gateway-autostart:v1:";

export type ModelGatewayAutostartStatus =
  | { readonly state: "installed"; readonly digest: string }
  | { readonly state: "absent" }
  | { readonly state: "foreign" }
  | { readonly state: "unsupported"; readonly platform: string };

export interface ModelGatewayTaskSchedulerResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class WindowsModelGatewayAutostartAdapter {
  readonly #platform: string;
  readonly #runtimeDir: string;
  readonly #userId: string;
  readonly #taskName: string;
  readonly #run: (args: readonly string[]) => Promise<ModelGatewayTaskSchedulerResult>;
  readonly #writeXml: (path: string, xml: string) => Promise<void>;
  readonly #remove: (path: string) => Promise<void>;

  constructor(input: {
    readonly platform?: string;
    readonly runtimeDir: string;
    readonly userId: string;
    readonly run?: (args: readonly string[]) => Promise<ModelGatewayTaskSchedulerResult>;
    readonly writeXml?: (path: string, xml: string) => Promise<void>;
    readonly remove?: (path: string) => Promise<void>;
  }) {
    this.#platform = input.platform ?? process.platform;
    this.#runtimeDir = input.runtimeDir;
    this.#userId = requireSafeField(input.userId, "Task Scheduler user id");
    this.#taskName = `Kiln Model Gateway ${createHash("sha256").update(this.#userId.toLowerCase(), "utf8").digest("hex").slice(0, 12)}`;
    this.#run = input.run ?? runTaskScheduler;
    this.#writeXml = input.writeXml ?? (async (path, xml) => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, Buffer.from(xml, "utf16le"), { mode: 0o600 });
    });
    this.#remove = input.remove ?? ((path) => rm(path, { force: true }));
  }

  async status(): Promise<ModelGatewayAutostartStatus> {
    if (this.#platform !== "win32") return { state: "unsupported", platform: this.#platform };
    const result = await this.#run(["/Query", "/TN", this.#taskName, "/XML"]);
    if (result.exitCode !== 0) {
      if (isMissingTask(result)) return { state: "absent" };
      throw new Error(`Task Scheduler query failed: ${sanitizeDiagnostic(result.stderr || result.stdout)}`);
    }
    const match = result.stdout.match(/<Description>\s*kiln:model-gateway-autostart:v1:([a-f0-9]{64})\s*<\/Description>/);
    return match?.[1] ? { state: "installed", digest: match[1] } : { state: "foreign" };
  }

  async install(launch: ModelGatewayLaunchDescriptor): Promise<ModelGatewayAutostartStatus> {
    if (this.#platform !== "win32") return { state: "unsupported", platform: this.#platform };
    const digest = createModelGatewayAutostartDigest(launch);
    const current = await this.status();
    if (current.state === "foreign") return current;
    if (current.state === "installed" && current.digest === digest) return current;
    const xmlPath = win32.join(this.#runtimeDir, "autostart-task.xml");
    await this.#writeXml(xmlPath, createTaskXml({ launch, digest, userId: this.#userId }));
    try {
      const result = await this.#run(["/Create", "/TN", this.#taskName, "/XML", xmlPath, "/F"]);
      if (result.exitCode !== 0) throw new Error(`Task Scheduler install failed: ${sanitizeDiagnostic(result.stderr || result.stdout)}`);
    } finally {
      await this.#remove(xmlPath);
    }
    return { state: "installed", digest };
  }

  async uninstall(): Promise<ModelGatewayAutostartStatus> {
    if (this.#platform !== "win32") return { state: "unsupported", platform: this.#platform };
    const current = await this.status();
    if (current.state === "absent" || current.state === "foreign") return current;
    const result = await this.#run(["/Delete", "/TN", this.#taskName, "/F"]);
    if (result.exitCode !== 0) throw new Error(`Task Scheduler uninstall failed: ${sanitizeDiagnostic(result.stderr || result.stdout)}`);
    return { state: "absent" };
  }
}

export function createModelGatewayAutostartDigest(launch: ModelGatewayLaunchDescriptor): string {
  validateLaunch(launch);
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: launch.schemaVersion,
    command: launch.command,
    args: launch.args,
    mode: launch.mode,
    version: launch.version,
    requiredEnvNames: [...new Set(launch.requiredEnvNames)].sort(),
    host: launch.host,
  }), "utf8").digest("hex");
}

function createTaskXml(input: { readonly launch: ModelGatewayLaunchDescriptor; readonly digest: string; readonly userId: string }): string {
  validateLaunch(input.launch);
  const argumentsValue = input.launch.args.map(quoteWindowsArgument).join(" ");
  return [
    '\ufeff<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${OWNERSHIP_PREFIX}${input.digest}</Description>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    `      <UserId>${escapeXml(input.userId)}</UserId>`,
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${escapeXml(input.userId)}</UserId>`,
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${escapeXml(input.launch.command)}</Command>`,
    `      <Arguments>${escapeXml(argumentsValue)}</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}

function quoteWindowsArgument(value: string): string {
  requireSafeField(value, "Task Scheduler argument");
  if (value.length > 0 && !/[\s"]/.test(value)) return value;
  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") { backslashes += 1; continue; }
    if (character === '"') { result += "\\".repeat(backslashes * 2 + 1) + '"'; backslashes = 0; continue; }
    result += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + "\\".repeat(backslashes * 2) + '"';
}

function validateLaunch(value: ModelGatewayLaunchDescriptor): void {
  if (value.schemaVersion !== 2 || !value.command || !value.version || !["installed", "local-dev"].includes(value.mode)) throw new Error("Invalid model gateway autostart launch descriptor.");
  validateModelGatewayHostIdentity(value.host);
  requireSafeField(value.command, "Task Scheduler executable");
  value.args.forEach((argument) => requireSafeField(argument, "Task Scheduler argument"));
  if (value.requiredEnvNames.some((name) => !/^[A-Z_][A-Z0-9_]*$/.test(name))) throw new Error("Invalid model gateway autostart environment name.");
}

function requireSafeField(value: string, label: string): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error(`${label} must be a non-empty single-line value.`);
  return value;
}
function escapeXml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function isMissingTask(result: ModelGatewayTaskSchedulerResult): boolean {
  return /cannot find|not found|no existe|no puede encontrar el archivo especificado/i.test(`${result.stdout}\n${result.stderr}`);
}
function sanitizeDiagnostic(value: string): string { return value.replace(/[\r\n]+/g, " ").trim().slice(0, 512) || "unknown error"; }

async function runTaskScheduler(args: readonly string[]): Promise<ModelGatewayTaskSchedulerResult> {
  return new Promise((resolve) => {
    execFile("schtasks.exe", [...args], { encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
      resolve({ exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
