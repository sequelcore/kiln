export const NODE_VERIFIER_IMAGE = "node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f";
import { execFile } from "node:child_process";

const VERIFIER_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_048_576;

export function buildContainerVerifierArgs(input: {
  readonly name: string;
  readonly image: string;
  readonly mounts: readonly { readonly source: string; readonly target: string }[];
  readonly command: readonly string[];
}): readonly string[] {
  return [
    "run",
    "--rm",
    "--pull",
    "never",
    "--name",
    input.name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "64",
    "--memory",
    "256m",
    "--cpus",
    "1",
    "--user",
    "65532:65532",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=16m",
    ...input.mounts.flatMap((mount) => ["--volume", `${mount.source}:${mount.target}:ro`]),
    input.image,
    ...input.command,
  ];
}

export interface ContainerVerifierProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly infrastructureFailure: boolean;
}

export interface ContainerVerifierRunner {
  run(containerName: string, args: readonly string[]): Promise<ContainerVerifierProcessResult>;
  cleanup(containerName: string): Promise<void>;
}

export const CONTAINER_VERIFIER_RUNNER: ContainerVerifierRunner = {
  run: (_containerName, args) => runDocker(args),
  cleanup: async (containerName) => {
    await execDocker(["rm", "--force", containerName], 5_000).catch(() => undefined);
  },
};

async function runDocker(args: readonly string[]): Promise<ContainerVerifierProcessResult> {
  try {
    const result = await execDocker(args, VERIFIER_TIMEOUT_MS);
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
      infrastructureFailure: false,
    };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
      timedOut: failure.killed === true,
      infrastructureFailure: isDockerInfrastructureFailure(failure),
    };
  }
}

function isDockerInfrastructureFailure(
  failure: Error & { readonly code?: number | string; readonly stderr?: string; readonly killed?: boolean },
): boolean {
  if (failure.killed === true || failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return false;
  if (typeof failure.code !== "number") return true;
  return failure.code === 125 || failure.code === 126 || failure.code === 127;
}

function execDocker(
  args: readonly string[],
  timeout: number,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      [...args],
      {
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
