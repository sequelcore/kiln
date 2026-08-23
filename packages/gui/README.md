# @kilnai/gui

Rich web operator surface for the Kiln control plane.

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state.

## Source use

`@kilnai/gui` builds the static GUI assets consumed by `@kilnai/runtime`. From
the repository root, start the source GUI through the CLI:

```bash
bun packages/cli/src/index.ts gui --dev
```

The current package coordinate is expected to change before the next public
release.

## Development

```bash
bun run dev          # Vite dev server on http://127.0.0.1:5183
bun run build        # Production bundle → dist/
bun run typecheck    # TypeScript check
bun run lint         # Biome
bun run test         # Vitest unit/component tests (single run)
```

## Design system

The GUI uses shadcn with Base UI primitives. Project configuration lives in
`components.json`, generated UI components live in `src/components/ui/`, and
shared class merging lives in `src/lib/utils.ts`.

Use semantic shadcn/Kiln tokens (`bg-card`, `text-muted-foreground`,
`border-border`, `ring-ring`) rather than raw colors. The global token bridge
is `src/styles.css`; update it instead of creating a second palette.

The current product direction is a dense operator surface, not a generic
dashboard: compact rows, hairline dividers, provider glyphs, clear active
continuation state, and visible telemetry where it helps supervision.

The visual direction follows Kiln's restrained biocybernetic cyberpunk identity:
Phosphor dark glass, explicit control materials, precise signal color, and controlled
ember accents. It should read as a serious control plane, not a decorative
sci-fi skin or a borrowed code-editor theme.

Thinking Orbs and Border Beam provide bounded operational signals in the
composer. Their state is derived from canonical activity events, paired with
visible text, and constrained by reduced-motion behavior. AI Elements remain
source-owned Kiln compositions; reconcile upstream changes selectively rather
than replacing runtime authority, replay, or accessibility contracts.

## Layout ownership

The shell is split into a left operator rail, an optional mode panel, and the
main chat column. Keep ownership boundaries explicit:

- the left rail owns operator mode navigation and collapse state
- the mode panel owns mode-specific navigation, currently canonical sessions
  plus the event-backed changed-files review panel
- the main chat column owns conversation, active document surfaces, and turn
  composition
- operator modes own diagnostics such as activity, changed files, approvals,
  memory, setup, and workspace navigation
- the composer owns draft input, slash commands, file affordances, plan mode,
  provider/model route, reasoning effort, and send behavior

Chat presentation is derived from canonical conversation state. A fresh chat
centers the shared operator prompt and the existing composer; an active chat
returns that same composer to the transcript dock. Never mount a second
composer for landing presentation or keep a separate draft path.

The compact composer keeps provider route and authority visible because they
govern the turn. Attachment and submission remain direct actions. Work mode,
goal setup, and deliberation share the turn-settings disclosure; exceptional
continuity and measured context remain event-driven indicators rather than
permanent labels.

Do not repeat the same summary telemetry in multiple headers. If a value helps
diagnose why a turn behaved a certain way, it belongs in the relevant
event-backed operator mode instead of persistent chrome.

Inspector data should come from canonical timeline projections, not separate
GUI-maintained caches for files, approvals, or continuity.

Session history comes from the shared `OperatorSessionSummary` projection at
`GET /operator/api/sessions`. The dashboard does not carry a second session
list, and the GUI validates every projected row at the HTTP boundary. Provider
and model badges reflect the latest evidenced executed route; absent model
evidence remains absent.

The changed-files mode is intentionally honest about current runtime evidence:
it can show canonical file-change records and line deltas, but full diff hunks
must stay gated until the runtime emits structured diff payloads.

## Commands

`Ctrl+K` or `Cmd+K` opens the global command palette. Typing `/` into an empty
composer opens the composer-attached command surface. Both surfaces should use
the same command model, but their placement is intentional: global commands are
navigation/action commands, while slash commands are message-composition
commands.

## Settings

`/settings` redirects to `/settings/general`. The settings workspace owns nine
routes: General, Providers, Models, Permissions, Tools, Usage and Limits,
Agents, Health, and Advanced. Desktop and narrow layouts use the same route and
search model; `/` focuses settings search when the workspace is active.

Rows consume the schema-validated `KilnSettingsSnapshot` from
`GET /gui/api/config/settings`. They do not read YAML or derive configuration
policy in React. Set and reset actions create a typed proposal, show its scope,
authority and activation consequences, then apply through the authenticated
local gateway. The page refetches effective state after commit and distinguishes
rejection, revision conflict, and committed reconciliation failure. Advanced
export is secret-free inspection; import validates an export but cannot write
configuration.

## E2E tests (Playwright)

Install the browser once:

```bash
bun run playwright:install
```

Then run the e2e suite:

```bash
bun run test:e2e
```

Or from the repo root:

```bash
bun run test:e2e
```

The e2e suite starts a loopback-only Vite dev server automatically (reuses an
existing one if already running outside CI). A lightweight mock gateway binds
to `127.0.0.1` on a reserved port for each test worker and admits that exact
Vite origin for `/health`, `/gui/api/*`, `/operator/api/*`, and `/gui/ws`.

To run with the Playwright UI:

```bash
bun run test:e2e:ui
```
