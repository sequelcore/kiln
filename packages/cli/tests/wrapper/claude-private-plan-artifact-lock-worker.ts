import {
  CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
  createClaudePrivatePlanArtifactTracker,
} from "../../src/wrapper/claude-private-plan-artifacts.js";

const selectedConfigDir = process.argv[2];
if (!selectedConfigDir) process.exit(2);

const tracker = createClaudePrivatePlanArtifactTracker({
  capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
  selectedConfigDir,
});
if (tracker === undefined) process.exit(2);

try {
  await tracker.snapshot();
  process.stdout.write("entered\n");
  const evidence = await tracker.finalize();
  if (evidence.cleanupStatus !== "completed") process.exit(3);
  process.stdout.write("released\n");
} catch (error) {
  const code = error instanceof Error && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : "unknown";
  process.stdout.write(`failed:${code}\n`);
  process.exit(1);
}
