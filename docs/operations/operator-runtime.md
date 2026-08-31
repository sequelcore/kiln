# Operate the Operator Runtime

Operator Runtime is one machine-global supervised process shared by GUI, TUI,
CLI, and native-harness bridges. Closing or restarting one client surface does
not stop it.

## Inspect the runtime

From a source checkout, inspect the owned process before changing its lifecycle:

```bash
bun packages/cli/src/index.ts operator-runtime status --json
bun packages/cli/src/index.ts operator-runtime doctor --json
```

Ready status identifies the exact instance, process ID, start time, and loopback
port. Diagnostics do not expose runtime credentials.

## Submit and inspect Agent Tasks

The CLI talks to the authenticated Operator Runtime application protocol. It
does not require a working native-harness MCP client:

```bash
kiln agent-task submit --profile scout --wait "Inspect this boundary and summarize the evidence."
kiln agent-task status <job-id>
kiln agent-task result <job-id>
kiln agent-task replay <job-id>
kiln agent-task cancel <job-id>
```

Omit `--wait` to submit asynchronously. Add `--json` for a bounded machine
projection. The CLI accepts only a configured profile, objective, and optional
idempotency key; provider, model, account, route, authority, and concurrency are
Runtime-owned policy.

For an account-bound route, the selected execution account may differ from the
account running the operator's native harness. Account-policy eligibility,
health, quota evidence, and atomic capacity leases determine selection. Use
`kiln auth codex status --usage --emails` to inspect operator-visible account
usage; email addresses do not enter Agent Task records or child context.

After a successful task, `result` prints the bounded untrusted child handoff.
After a post-fence failure or restart, inspect `status` and `replay`: an
`interrupted` task with `result_pending` is deliberately not redispatched until
authoritative settlement or reconciliation resolves the external outcome.

## Restart after rebuilding

A workspace build updates files on disk but cannot replace code already loaded
by the running Operator Runtime. After rebuilding changes to CLI, Runtime, Core,
gateway contracts, or provider adapters, restart the supervised process:

```bash
bun packages/cli/src/index.ts operator-runtime restart --json
```

Then restart or reconnect the affected operator surface. Verify that status is
`ready` and that the instance ID and process ID differ from the pre-restart
status. Restarting only GUI or TUI is insufficient because those surfaces reuse
the machine-global process.

Lifecycle mutations publish complete owner metadata atomically. A lock owned by
a live process remains fail-closed; a lock owned by a dead process is reclaimed
automatically. Empty or malformed locks remain fail-closed for a 30-second
recovery grace, then are reclaimed. Manual deletion should therefore be reserved
for diagnosis of an older build, not normal recovery.

## Diagnose local GUI shutdown

In GUI development mode, `[gui-dev] stopped` means the managed app window was
observed as closed and the CLI consequently stopped Vite and the local Gateway.
Client-side navigation, including opening Settings, must not trigger that
lifecycle. Kiln binds ownership to the Chromium DevTools page target ID, which
remains stable while the SPA URL changes.

A browser message saying that `/gui/ws` closed before its connection was
established is not a healthy steady-state condition. It can be harmless during
an intentional GUI shutdown; paired with an unexpected `[gui-dev] stopped`, it
means the local Gateway disappeared and the window-lifecycle owner should be
investigated first.

Action-claim stores are exclusive effect owners. A normal GUI shutdown releases
them immediately. After an abrupt process exit, startup remains fail-closed until
the last heartbeat is 30 seconds old; close any still-running GUI or TUI and retry
after the duration reported by the error. Do not delete the SQLite claim state:
the successor uses it to preserve uncertain effects as non-replayable evidence.

The Runtime error `The Runtime model round was claimed; its provider outcome is
not safely replayable` is a fail-closed replay guard, not permission to retry a
possibly completed provider effect. Operator GUI and TUI routes materialize the
exact credential-bound direct-provider adapter before entering that claim. If
the error recurs after a source rebuild and Operator Runtime restart, preserve
the claim evidence and diagnose the underlying provider transport rather than
deleting state or automatically replaying the prompt.

## Other lifecycle commands

Use `start` when the runtime must already be stopped, `ensure` when either an
existing ready instance or a newly started instance is acceptable, and `stop`
when no operator surface or native-harness bridge should use the runtime.
Lifecycle commands act through the exact-instance supervisor; do not kill an
unverified process by port or executable name.
