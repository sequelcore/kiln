import { spawn } from "node:child_process";

interface HarnessTestCommand {
  readonly label: string;
  readonly args: readonly string[];
}

const runtimeManagedAgentTests = [
  "tests/managed-agent/invocation-service.test.ts",
  "tests/managed-agent/fan-out-lifecycle.test.ts",
  "tests/managed-agent/context-and-credential-admission.test.ts",
  "tests/managed-agent/live-write-event-bridge.test.ts",
  "tests/managed-agent/remote-harness-adapter.test.ts",
  "tests/managed-agent/recovery-daemon.test.ts",
  "tests/managed-agent/resource-provider.test.ts",
  "tests/managed-agent/write-boundary.test.ts",
  "tests/managed-agent/live-test-harness.test.ts",
  "tests/managed-agent/opencode-cli-harness-adapter.test.ts",
  "tests/managed-agent/direct-runtime-adapter.test.ts",
  "tests/session/managed-invocation-session-events.test.ts",
  "tests/session/managed-invocation-prompt-admission.test.ts",
] as const;

const commands: readonly HarnessTestCommand[] = [
  {
    label: "gateway-contracts managed-agent cockpit projections",
    args: [
      "run",
      "--filter",
      "@kilnai/gateway-contracts",
      "test",
      "tests/operator-cockpit-projection.test.ts",
      "tests/operator-cockpit-view-state.test.ts",
    ],
  },
  {
    label: "runtime managed-agent deterministic lifecycle",
    args: ["run", "--cwd", "packages/runtime", "test", ...runtimeManagedAgentTests],
  },
  {
    label: "GUI managed-agent cockpit/session transport",
    args: [
      "run",
      "--cwd",
      "packages/gui",
      "test",
      "tests/managed-agent-cockpit-panel.test.tsx",
      "tests/ws-client.test.ts",
      "tests/session-store.test.ts",
    ],
  },
  {
    label: "TUI managed-agent cockpit/session transport",
    args: ["run", "--cwd", "packages/tui", "test", "tests/managed-agent-cockpit.test.ts"],
  },
];

const bunCommand = process.execPath;

for (const command of commands) {
  console.log(`\n[test:harness] ${command.label}`);
  const exitCode = await runCommand(command.args);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}

function runCommand(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bunCommand, args, {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", (error) => {
      console.error(`[test:harness] failed to start ${bunCommand}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
