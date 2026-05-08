# Interactive Use Plan - Browser And Computer Automation

## Objective

Add Kiln's governed `interactive_use` capability for browser and computer
automation across surfaces. Browser use and computer use must share policy,
trace, artifact, and approval contracts instead of becoming GUI-only behavior.

## Research Basis

- OpenAI Computer Use treats UI automation as a loop of model actions,
  executed by application code, with isolated environments, allowlists, and
  human approval for irreversible or sensitive actions.
- Anthropic Computer Use uses screenshots plus mouse/keyboard control, and
  explicitly recommends virtualized/sandboxed environments, domain allowlists,
  and human confirmation for consequential actions.
- Google Project Mariner exposes task replay and attention checkpoints, which
  supports Kiln's evidence/replay thesis.
- WebArena, WebVoyager, and OSWorld show that realistic browser/computer agents
  need interactive environments, reproducible traces, multimodal observations,
  and evaluation artifacts.
- Playwright's BrowserContext model makes isolated browser sessions cheap and
  reproducible, so background web automation belongs in the browser provider
  before Kiln attempts heavier remote desktop environments.
- Microsoft UI Automation is an accessibility/testing API for the Windows
  desktop and does not turn the operator's local session into an invisible
  background computer. Background desktop automation requires an explicit VM,
  remote worker, or cloud computer environment.

## Non-Goals

- Do not replace `web_search`, `web_fetch`, or `web_extract`.
- Do not add Playwright as a core dependency.
- Do not put browser/computer authority in GUI state.
- Do not expose raw browser page content as privileged instructions.
- Do not automate real credentials, payments, account changes, or destructive
  operations without approval gates.

## Slices

### Slice 1 - Core Contracts And Fail-Closed Tools

Status: implemented and verified on 2026-05-08.

Files:

- `packages/core/src/tools/domain/tool.ts`
- `packages/core/src/tools/domain/tool-result-metadata.ts`
- `packages/core/src/tools/infrastructure/interactive-use-tool.ts`
- `packages/core/src/tools/default-tool-surface.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/tests/tools/domain/tool.test.ts`
- `packages/core/tests/tools/infrastructure/interactive-use-tool.test.ts`
- `packages/core/tests/tools/default-tool-surface.test.ts`
- `packages/core/tests/tools/mcp/dev-tools-server.test.ts`
- `packages/cli/tests/tools-command.test.ts`

Behavior:

- Add `browser_session_start`, `browser_navigate`, `browser_observe`,
  `browser_click`, `browser_type`, `browser_keypress`, `browser_scroll`,
  `browser_session_stop`, `computer_observe`, `computer_click`,
  `computer_type`, `computer_keypress`, `computer_open_application`,
  `computer_focus_application`, `computer_minimize_application`, and
  `computer_close_application`.
- Add `interactive` metadata with provider, target, session id, action,
  observation, artifact links, approval sensitivity, and typed errors.
- Default provider fails closed with `provider_not_configured`.
- Mark observation tools read-only/idempotent; action tools destructive so
  existing authority/approval behavior applies.

Verification:

- `bun x vitest run packages/core/tests/tools/domain/tool.test.ts packages/core/tests/tools/infrastructure/interactive-use-tool.test.ts packages/core/tests/tools/default-tool-surface.test.ts --maxWorkers=1`
- `bun x vitest run packages/core/tests/tools/domain/tool-catalog.test.ts packages/core/tests/tools/domain/tool-resource-registry.test.ts packages/core/tests/tools/mcp/dev-tools-server.test.ts packages/cli/tests/tools-command.test.ts --maxWorkers=1`
- `bun run --filter @kilnai/core typecheck`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/core build`

### Slice 2 - Configuration And Surface Projection

Status: implemented and verified on 2026-05-08 for project-scoped authority,
diagnostics, and shared surface projection.

Files:

- `packages/cli/src/kiln-yaml-types.ts`
- `packages/cli/src/kiln-yaml.ts`
- `packages/cli/src/config-status.ts`
- `packages/cli/tests/config/*.test.ts`
- `docs/guides/tool-use.md`

Behavior:

- Add project-scoped `interactiveUse` authority with `enabled`,
  `allowedDomains`, `allowedApplications`, `allowExternalBrowser`,
  `allowComputer`, and provider selection.
- Keep provider capability reusable, but authority local to project config.
- Status reports configured capability without executing automation.
- GUI, TUI, run, tools MCP, and benchmark sessions compose web, memory, and
  interactive-use options through one builtin tool surface configuration path.

Verification:

- `bun x vitest run packages/cli/tests/config/interactive-use-config.test.ts --maxWorkers=1`
- `bun run typecheck`

### Slice 3 - Runtime Adapter Boundary

Status: implemented and verified on 2026-05-08 for runtime provider injection
through the shared builtin surface. Concrete providers remain slices 4 and 6.

Files:

- `packages/runtime/src/gateway/attached-runtime-tool-surface.ts`
- `packages/runtime/tests/gateway/*.test.ts`

Behavior:

- Runtime attaches configured interactive-use provider adapters to the shared
  core tool surface.
- GUI/TUI/CLI receive the same tool metadata and approval events.
- No surface implements a private automation executor.

Verification:

- `bun x vitest run packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts --maxWorkers=1`

### Slice 4 - Browser Provider MVP

Status: implemented and verified on 2026-05-08 as an optional runtime
Playwright provider wired from `interactiveUse.browserProvider=playwright`.

Files:

- New runtime/browser provider package or adapter module.
- Focused provider tests.

Behavior:

- Implement Playwright-backed browser sessions outside core.
- Capture screenshots, DOM/accessibility snapshot, console log, network log,
  trace/video artifact references, and action history.
- Enforce allowed domains and approval-sensitive action classification.

Implemented now:

- `PlaywrightBrowserUseProvider` lives in runtime and implements the shared
  `InteractiveUseProvider` contract.
- `playwright` is an optional peer dependency; missing setup produces a clear
  operator-facing error with the install commands.
- The provider supports session start, navigate, observe, click, type,
  keypress, scroll, stop, allowed-domain enforcement, and screenshot artifact
  sink hooks.
- Browser screenshot observations are materialized into session artifacts by
  the shared tool layer so transcripts keep `screenshotUri` resource links
  instead of large inline base64 payloads.
- Playwright sessions should be closed explicitly with `browser_session_stop`
  for one-off tasks, and the runtime provider also closes idle sessions as a
  cleanup backstop.
- If the optional peer or browser install is missing, the tool error names the
  missing setup and gives concrete install commands instead of falling back to a
  generic provider-not-configured message.

Verification:

- `bun x vitest run packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts packages/core/tests/tools/domain/tool.test.ts --maxWorkers=1`
- `bun x vitest run packages/cli/tests/config/interactive-use-config.test.ts packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts packages/cli/tests/commands/run-builtin-tools.test.ts --maxWorkers=1`
- `bun run --filter @kilnai/cli typecheck`
- `bun run --filter @kilnai/runtime typecheck`
- `bun run --filter @kilnai/runtime build`

### Slice 5 - GUI Live Browser Projection

Status: implemented and verified on 2026-05-08 for dynamic browser tab
projection.

Files:

- `packages/gateway-contracts/src/frames.ts`
- `packages/runtime/src/gateway/interactive-use-frame.ts`
- `packages/gui/src/components/operator-surface-tabs.tsx`
- `packages/gui/src/components/app-shell.tsx`
- `packages/gui/src/api/client.ts`
- `packages/gui/src/lib/session-store.ts`
- Focused runtime and GUI tests.

Behavior:

- Render Browser as a dynamic workbench tab from runtime
  `interactive_use_updated` frames, not as a permanent primary sidebar surface.
- Project current URL, title, status, provider/session metadata, screenshot
  data URL, and artifact URI evidence.
- Resolve screenshot artifact URIs through the GUI resource endpoint so the tab
  can display artifact-backed screenshots without storing base64 in transcript
  metadata.
- Support takeover/control handoff later without changing runtime contracts.

Verification:

- `bun x vitest run packages/runtime/tests/gateway/interactive-use-frame.test.ts packages/runtime/tests/interactive/windows-computer-use-provider.test.ts packages/cli/tests/config/interactive-use-config.test.ts --maxWorkers=1`
- `bun run --cwd packages/gui test:run tests/operator-surface-tabs.test.tsx`
- `bun run --filter @kilnai/gui typecheck`

### Slice 6 - Computer Provider MVP

Status: implemented and verified on 2026-05-08 as an optional Windows provider
backed by `@nut-tree/nut-js`.

Files:

- `packages/runtime/src/interactive/windows-computer-use-provider.ts`
- `packages/runtime/tests/interactive/windows-computer-use-provider.test.ts`
- `packages/cli/src/config/interactive-use-config.ts`
- `packages/runtime/package.json`

Behavior:

- Start with Windows because Kiln's operator environment is Windows.
- Capture screen observations and run mouse/keyboard actions through an
  optional native automation dependency.
- Enforce `interactiveUse.allowComputer` and `interactiveUse.allowedApplications`
  before executing provider actions.
- Require a trusted active application resolver from the runtime host; the
  model-supplied `application` field is not allowlist evidence.
- Missing setup returns an operator-facing error with the install command:
  `bun add -d @nut-tree/nut-js`.
- Keep macOS/Linux as later providers under the same contracts.

Decision made: `@nut-tree/nut-js` is the first native dependency boundary
because it exposes mouse, keyboard, screen capture, and window-oriented
automation for Windows without putting OS calls in core or GUI code.

### Slice 7 - Windows UI Automation Semantic Provider

Status: implemented and verified on 2026-05-08 as `computerProvider:
windows-uia`.

Files:

- `packages/runtime/src/interactive/windows-uia-computer-use-provider.ts`
- `packages/runtime/tests/interactive/windows-uia-computer-use-provider.test.ts`
- `packages/runtime/native/windows-uia/build.cmd`
- `packages/runtime/native/windows-uia/kiln-windows-uia.vcxproj`
- `packages/runtime/native/windows-uia/src/kiln-windows-uia.cpp`
- `packages/cli/src/config/interactive-use-config.ts`
- `packages/runtime/package.json`
- `docs/architecture/developer-tools.md`
- `docs/guides/tool-use.md`

Behavior:

- Add a semantic Windows provider backed by Microsoft UI Automation through a
  Kiln-owned native sidecar, not a third-party Node native wrapper.
- Derive trusted active-window authority from Windows UIA focus ancestry before
  evaluating `interactiveUse.allowedApplications`.
- When a request names `application` or `windowTitle`, validate that target
  against `allowedApplications` before opening, focusing, minimizing, or closing
  the window.
- Expose the UIA accessibility tree through `computer_observe` when
  `includeAccessibility` is requested.
- Execute semantic targets such as `type=button;title=OK` through UIA
  `InvokePattern`; execute text targets through `ValuePattern`.
- Reject coordinate-only pointer actions with a clear error that directs the
  operator to `computerProvider=windows` for low-level mouse/keyboard work.
- Provide graceful app lifecycle tools for allowed apps:
  `computer_open_application`, `computer_focus_application`,
  `computer_minimize_application`, and `computer_close_application`.
- Missing setup returns an operator-facing error with the install command:
  `packages\runtime\native\windows-uia\build.cmd`.
- Runtime communication with the sidecar uses JSON over stdin/stdout so typed
  text is not passed in process arguments.

### Slice 8 - Interactive Environment Policy

Status: implemented and verified on 2026-05-08.

Files:

- `packages/runtime/src/interactive/playwright-browser-use-provider.ts`
- `packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts`
- `packages/cli/src/kiln-yaml-types.ts`
- `packages/cli/src/kiln-yaml.ts`
- `packages/cli/src/config/interactive-use-config.ts`
- `packages/cli/src/commands/config.ts`
- `packages/cli/src/commands/status.ts`
- `packages/cli/tests/config/interactive-use-config.test.ts`
- `packages/cli/tests/commands/config.test.ts`
- `.kiln/kiln.yaml`
- `docs/architecture/developer-tools.md`
- `docs/guides/tool-use.md`

Behavior:

- Add `interactiveUse.browserEnvironment` with `isolated-headless` as the
  default and `isolated-headed` as an explicit visible-debugging mode.
- Make the Playwright provider reject `headless:false` requests unless the
  runtime was configured for headed browser sessions.
- Add `interactiveUse.computerEnvironment` with the current supported value
  `local-active-desktop`.
- Keep local Windows UIA honest: it is semantic automation for the active
  interactive desktop, not a hidden background desktop.
- Configure this repo for background browser automation with
  `browserProvider: playwright`, `browserEnvironment: isolated-headless`, and
  `allowedDomains: ["*"]` while preserving `windows-uia` desktop testing.
- Route Playwright through a persistent Node sidecar on Windows+Bun because
  Chromium launch hangs under Bun in the operator environment while the same
  launch succeeds under Node.
- Keep browser screenshots artifact-backed and apply idle cleanup so live GUI
  transcripts do not balloon and forgotten sidecar browser sessions do not
  accumulate.
- Keep Browser out of the primary sidebar; surface active browser sessions as
  dynamic tabs and load screenshot artifacts through the runtime resource
  plane.

Verification:

- `bun x vitest run packages/runtime/tests/interactive/playwright-browser-use-provider.test.ts --maxWorkers=1`
- `bun x vitest run packages/cli/tests/config/interactive-use-config.test.ts --maxWorkers=1`
- `bun x vitest run packages/cli/tests/commands/config.test.ts --maxWorkers=1`
- `bun run --filter @kilnai/runtime typecheck`
- `bun run --filter @kilnai/cli typecheck`
- `bun run typecheck`
- `bun run test`

### Slice 9 - Cross-Surface Resume Contract And Live Projections

Status: implemented and verified on 2026-05-08.

Files:

- `packages/gui/src/lib/session-store.ts`
- `packages/gui/src/components/app-shell.tsx`
- `packages/gui/tests/session-store.test.ts`
- `packages/gui/tests/parity/01-session-lifecycle.spec.ts`
- `packages/gui/tests/parity/04-input-ergonomics.spec.ts`
- `packages/cli/src/commands/tui.ts`
- `packages/cli/tests/commands/tui-session-persistence.test.ts`
- `packages/runtime/src/interactive/windows-uia-computer-use-provider.ts`
- `packages/runtime/native/windows-uia/src/kiln-windows-uia.cpp`
- `packages/runtime/tests/interactive/windows-uia-computer-use-provider.test.ts`
- `docs/architecture/session-model.md`
- `docs/guides/gui.md`
- `docs/guides/tui.md`

Behavior:

- Treat session history selection as preview-only in GUI.
- Do not persist GUI resume intent in `localStorage`; clear stale
  `kiln.gui.resumeTarget` values on startup and session selection.
- Start fresh when the operator types from a historical preview without an
  explicit resume action.
- Preserve explicit GUI resume for the next turn when the operator uses empty
  submit on the selected historical session.
- Stop TUI startup from loading `.kiln/resume-targets.json` as hidden active
  continuation state.
- Keep CLI `run --resume` as the explicit non-interactive resume path.
- Restore persisted interactive browser snapshots from canonical session events
  and switch the GUI workbench to the Browser tab when browser evidence arrives.
- Match Windows Calculator aliases consistently across the TypeScript UIA
  provider and the native sidecar so open/focus/minimize/close flows use the
  same allowlist semantics.

Verification:

- `bun run --filter @kilnai/gui test -- session-store.test.ts composer.test.tsx --maxWorkers=1`
- `bun run --filter @kilnai/cli test -- commands/tui-session-persistence.test.ts`
- `bun run --filter @kilnai/runtime test -- interactive/windows-uia-computer-use-provider.test.ts`
- `bun run --filter @kilnai/gui test -- app-shell-sidebar-modes.test.tsx operator-surface-tabs.test.tsx session-list.test.tsx --maxWorkers=1`
- `bun run typecheck`
- `packages\runtime\native\windows-uia\build.cmd`
- `bun run build`

### Slice 10 - Windows UIA Semantic Action Reliability

Status: implemented and verified on 2026-05-08.

Files:

- `packages/core/src/tools/domain/tool.ts`
- `packages/runtime/src/interactive/windows-uia-computer-use-provider.ts`
- `packages/runtime/native/windows-uia/src/kiln-windows-uia.cpp`
- `packages/runtime/tests/interactive/windows-uia-computer-use-provider.test.ts`
- `docs/architecture/developer-tools.md`
- `docs/guides/tool-use.md`

Behavior:

- Normalize accessibility-tree refs such as `#plusButton` to UIA
  `AutomationId` selectors before calling the sidecar.
- Fail `computer_click` when the target does not support a real UIA invoke
  pattern instead of reporting success after focus-only behavior.
- Allow `computer_focus_application` to return focus to the Kiln operator
  window as self-authority when computer use is enabled, without allowing
  close or arbitrary automation of Kiln by default.
- Keep low-level pointer/keyboard transport out of `windows-uia`; coordinate
  and raw keyboard tasks remain outside this semantic provider.

Verification:

- `bun run --filter @kilnai/runtime test -- interactive/windows-uia-computer-use-provider.test.ts`

## Verification

- Focused core tests for slice 1.
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/core build`
- Relevant CLI/runtime tests as later slices land.
- Full `bun run typecheck` before claiming complete.
