import { spawn as nodeSpawn } from "node:child_process";
import { win32 } from "node:path";

type WindowsProcessTreeRunner = (
  executable: string,
  args: readonly string[],
  options: { readonly windowsHide: true; readonly shell: false; readonly stdio: "ignore" },
) => Promise<number | null>;

export interface WindowsProcessTreeTerminationOptions {
  readonly systemRoot?: string;
  readonly run?: WindowsProcessTreeRunner;
}

export function resolveWindowsTaskkillExecutable(systemRoot: string | undefined): string | undefined {
  if (typeof systemRoot !== "string"
    || systemRoot.includes("\u0000")
    || !win32.isAbsolute(systemRoot)) return undefined;
  return win32.join(systemRoot, "System32", "taskkill.exe");
}

/** Terminates one already-authorized Windows process tree without shell or PATH resolution. */
export async function terminateWindowsProcessTree(
  pid: number,
  options: WindowsProcessTreeTerminationOptions = {},
): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const executable = resolveWindowsTaskkillExecutable(options.systemRoot ?? process.env.SystemRoot);
  if (executable === undefined) return false;
  const run = options.run ?? runProcess;
  try {
    return await run(executable, ["/pid", String(pid), "/t", "/f"], {
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    }) === 0;
  } catch {
    return false;
  }
}

function runProcess(
  executable: string,
  args: readonly string[],
  options: { readonly windowsHide: true; readonly shell: false; readonly stdio: "ignore" },
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(executable, [...args], options);
    child.once("error", reject);
    child.once("close", resolve);
  });
}
