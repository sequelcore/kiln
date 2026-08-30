const { runCliStartupChild } = await import("../../scripts/profile-startup-cli.ts");

const input = JSON.parse(process.env.KILN_PROFILE_CHILD_INPUT ?? "null");
if (input === null || typeof input !== "object") {
  throw new Error("Child harness requires KILN_PROFILE_CHILD_INPUT JSON.");
}
const result = await runCliStartupChild(input);
process.stdout.write(`${JSON.stringify(result)}\n`);
