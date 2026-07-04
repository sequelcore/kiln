# Active Implementation Plan

Updated: 2026-07-04

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

## Implementation

1. Add failing tests and the global instruction projection service for target
   paths, signed deterministic rendering, classification, drift, backup,
   adoption, and install-state ownership.
2. Integrate global instruction targets into `kiln sync`, setup/status, and
   ownership-aware uninstall using the shared contracts.
3. Change repo-shim rendering and tests so repo files specialize inherited
   global doctrine without duplicating it.
4. Correct canonical Go/Zen doctrine and operator configuration, then migrate
   existing unmanaged global files explicitly with byte-preserving backups.
5. Update architecture/operator docs and roadmap evidence.

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

Do not migrate the operator's real global files or mark this correction closed
until unmanaged-file backup, drift refusal, install-state ownership, status
parity, and uninstall behavior pass in an isolated home.
