# Operator Surfaces

## Purpose

This guide explains which Kiln surface to use for each operating context. The
architecture rule is simple: one governed runtime, many operator surfaces. A
surface may improve its own ergonomics, but shared behavior belongs in the
runtime, gateway contracts, core, or CLI layer first.

## Recommended Surface By Context

| Context | Recommended surface | Why |
|---|---|---|
| Local rich supervision | GUI via `kiln gui` | Best fit for session management, approvals, workspace browsing, telemetry, and multi-agent visibility. |
| Desktop-native operation | Native from source | Future fit for embedded browser hosting, native window lifecycle, notifications, packaged installs, and OS-level integrations. Native is not part of the global install contract in this release. |
| SSH or terminal-first work | TUI via `kiln tui` | Best fit when a browser is unavailable, terminal workflow is preferred, or a remote shell is the control channel. |
| Automation and scripts | CLI via `kiln` | Best fit for one-shot runs, CI, scheduled jobs, config sync, auth, and machine-readable output. |
| Code navigation and review | IDE surface | Best fit for inline diffs, jump-to-definition, editor-native context, and focused review. |
| Remote team operation | Remote GUI behind a gateway | Best fit for long-running supervised work, shared visibility, and browser access from another machine. |
| Chat or alert integrations | Gateway channel or connector | Best fit for Discord, Slack, webhook, or product-channel notifications and lightweight operator actions. |

Install the public operator package once per machine:

```bash
bun add -g @kilnai/cli@2.1.0
```

That install provides the official CLI, GUI, TUI, runtime, gateway contracts,
and GUI static assets. It is intended to work from any project directory,
including local repos, VPS shells, and deployable app repos.

## GUI

Use the GUI when the operator needs visual density: current session state,
work-items, tool evidence, approvals, files, telemetry, and provider/model
state in one place. It can run locally through `kiln gui` or attach to a gateway
when the deployment is prepared for remote access.

Remote GUI is a deployment pattern, not a separate runtime. A VPS deployment
must add HTTPS/TLS, authentication, session isolation, origin controls, rate
limits, and remote-safe tool authority profiles before exposure outside a
trusted tunnel.

## Native

Use the native surface when the workflow needs desktop capabilities that a web
GUI cannot provide cleanly: embedded browser hosting, native windows, local
notifications, tray/background behavior, packaged install/update flow, or
high-density local projection experiments.

Native remains a client of gateway/operator contracts. It must not import
runtime implementation code or own session authority. In this release, Native
is source-only experimental work and is not distributed through the global CLI
install.

## TUI

Use the TUI for terminal-native supervision: SSH sessions, low-bandwidth remote
operation, keyboard-first workflows, and operators who prefer a persistent
terminal control surface.

The TUI can receive feature work when the feature is genuinely terminal-facing
and remains a projection of shared runtime contracts. TUI work must not create
private provider, memory, tool, authority, or session semantics.

## CLI

Use the CLI for automation, not ongoing visual supervision. It owns commands
such as `run`, `plan`, `gui`, `tui`, `gateway`, `auth`, `sync`, `route`,
`project`, `tools`, `memory`, `cron`, and `benchmark`.

CLI changes should prefer deterministic output and clear failure modes over
interactive decoration.

## Shared Operator Commands

GUI command palette, TUI slash commands, and CLI operator command discovery use
the shared command catalog in
`packages/gateway-contracts/src/operator-commands.ts`. Do not add private
surface-local command lists for governed controls. Add the command once to the
contract, declare the supported surfaces, then project it into the surface UI.

The governed command set includes `/goal` on CLI, GUI, and TUI. Interactive
surfaces also expose `/plan` and `/exec` so planning/execution state is visible
and discoverable from the same command source.

## Gateway Integrations

Discord, Slack, webhooks, product channels, and similar integrations should
connect through gateway contracts or channel adapters. They are not replacements
for GUI, TUI, or CLI; they are external control and notification surfaces.

Good integration use cases:

- notify an operator when approval is required
- expose a compact status summary
- hand off a session to a human channel
- trigger a governed action with explicit authority

Bad integration use cases:

- bypassing gateway admission
- storing private session truth in the integration
- granting tool authority from chat text alone
- treating chat history as the replay source of truth

## Development Rule

Build the surface that matches the real workflow. If a capability is useful
across surfaces, implement the contract once in shared runtime/gateway/core and
project it to GUI, native, TUI, CLI, IDE, and integrations as needed.
