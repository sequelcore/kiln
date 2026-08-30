import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
if (mode === "descendant") {
  process.stdout.write("descendant-open\n");
  await new Promise(() => {});
}

if (mode !== "parent") {
  throw new Error(`Unknown fixture mode: ${mode ?? "missing"}`);
}

const descendant = spawn(process.execPath, [process.argv[1], "descendant"], {
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});
const pidFile = process.env.KILN_PROFILE_DESCENDANT_PID_FILE;
if (pidFile === undefined || descendant.pid === undefined) {
  throw new Error("Descendant fixture requires a pid file and a child pid.");
}
writeFileSync(pidFile, String(descendant.pid), "utf8");
process.stdout.write("parent-open\n");
await new Promise(() => {});
