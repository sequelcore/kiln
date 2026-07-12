# Active Implementation Plan

Updated: 2026-07-11

## Objective

Make Kiln the sole authority for cross-harness instruction projection at two
explicit scopes:

- Global native shims: `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, and
  `~/.config/opencode/AGENTS.md`.
- Repository specialization shims: `<repo>/AGENTS.md` for Codex/OpenCode and
  `<repo>/CLAUDE.md` for Claude Code.

Global shims carry resolved global doctrine. Repository shims carry only
project identity, adopted context, and project-scoped specialization. Neither
scope is canonical; durable authority remains under Kiln config, instruction
profiles, agents, skills, and project context.

## Evidence

- Codex officially loads `$CODEX_HOME/AGENTS.override.md` or
  `$CODEX_HOME/AGENTS.md`, then accumulates project instruction files from the
  project root toward the current directory.
- Claude Code officially loads user `~/.claude/CLAUDE.md` and applicable
  project `CLAUDE.md`/rules layers.
- OpenCode officially loads `~/.config/opencode/AGENTS.md` plus one selected
  project rule family; Claude compatibility is an optional alternative, not a
  Kiln projection contract.
- Cloned Codex, Claude Code, and OpenCode sources under
  `C:/Proyectos/Sequel/cloned` confirm those paths and precedence semantics.
- OpenCode Go and Zen both authenticate with OpenCode-issued API keys. Go
  consumes a subscription entitlement; Zen consumes credits for paid models
  and exposes explicitly free models. Both are Kiln direct providers and are
  independent of native OpenCode CLI permissions.

## Decisions

- Add one global instruction projection owner that renders three
  harness-specific signed whole-file targets.
- Reuse native install-state, file drift, backup, force, status, setup, and
  uninstall contracts. Do not add a parallel ownership mechanism.
- Block unmanaged files and drift by default. Migration requires explicit
  adoption/backup; native prose is never imported as canonical doctrine.
- Keep instruction guidance separate from permission enforcement and direct
  provider routing.
- Remove unchanged global doctrine, global agents, and global route policy from
  repository shims; render project-scoped overrides only.
- Do not use Claude compatibility paths, Codex fallback filenames, symlinks, or
  dual readers.
- The GUI gateway is the authority boundary for setup actions. It permits only
  project-context adoption, repo-shim sync, native projection sync, and safe
  global shim sync; disabled controls are defense in depth. Disallowed valid
  actions return blocked results before CLI mutation ownership is invoked.
- Global shim setup status carries canonical shared harness identity (`codex`,
  `claude-code`, or `opencode`), rendered directly by GUI and TUI.

## Completion

1. The global instruction projection owner renders signed deterministic
   Codex, Claude Code, and OpenCode entrypoints and uses shared install-state
   ownership, drift, backup, adoption, force, and uninstall contracts.
2. `kiln sync`, config setup/status, CLI status, TUI, and GUI consume the
   shared global-instruction projection contract, including each target's
   canonical recommendation in setup diagnostics.
3. Repo shims specialize project identity and adopted context without copying
   inherited global doctrine, global agents, routing, or native permissions.
4. Isolated-home tests prove governed adoption or byte-preserving backup,
   drift refusal, force, uninstall, and deterministic recreation. This work
   intentionally did not mutate an operator's real home-directory projections.
5. Architecture, operator-guide, and roadmap references are aligned with the
   completed projection slice.
6. Runtime negative tests prove valid review, adoption, force, and drift
   actions cannot bypass the GUI boundary; safe global sync retains the
   CLI-owned unmanaged and drift protections.

Verification closed on 2026-07-11: three controlled focused Core repetitions
passed 89/89 tests each; the one-worker Core suite passed 272 files / 3,454
tests; normal `@kilnai/core` testing passed the same count; and the required
root `typecheck`, `test`, `build`, `git diff --check`, and changed-files React
Doctor gates all passed. Follow-up contention evidence isolated and hardened a
sequential 205-file broad-glob test fixture without changing production
behavior or timeouts. Slice 1 is complete.

## Verification

- Focused Gateway Contracts and CLI projection/setup/status/sync/uninstall tests.
- Isolated-home migration proof: unmanaged -> backed up -> managed -> drifted ->
  protected -> uninstalled -> deterministically recreated.
- Direct-provider tests proving `codex-oauth`, `opencode-go`, and
  `opencode-zen` do not consume native CLI permission state.
- `bun run --filter @kilnai/gateway-contracts test`
- `bun run --filter @kilnai/cli test`
- `bun run typecheck`
- `bun run test`
- `bun run build`
- `git diff --check`
- Independent code, DDD, and adversarial reviews.

## Residual-Risk Gate

Do not migrate an operator's real global files without explicit authorization.
The completed isolated-home evidence proves lifecycle behavior, but it is not
live-home migration evidence.
