# 03 - Harness Installation Health

Status: Active
Started: 2026-06-24
Architecture:
`docs/architecture/config-projection.md`,
`docs/architecture/harness-integration-capabilities.md`,
`docs/architecture/provider-model-discovery.md`

## Objective

Make local harness readiness a first-class Kiln product capability. Operators
should be able to see which CLI/app installation is authoritative, whether a
provider model is actually runnable from the current surface, and what action
fixes drift before a task starts.

This roadmap exists because Codex, Claude Code, OpenCode, direct providers,
desktop apps, CLI shims, and package-manager installs do not share one native
installation or update contract. Kiln must not pretend they do. It should
detect, normalize, and report readiness through shared config/status contracts.

## Long-Term Feature Decision

Kiln should add a cross-harness health/readiness surface rather than embedding
one-off checks in provider wrappers.

The durable contract is:

- one canonical harness identity per executable surface;
- explicit evidence for resolved command path, version, auth state, and model
  probe result;
- warning-only diagnostics for competing aliases that do not affect command
  resolution;
- fail-closed execution admission when the selected model is not proven
  runnable;
- the same status through CLI, GUI, TUI, SDK/widget descriptors, and
  model-callable config/status tools.

## Slices

### Slice 1 - Codex CLI Path And Config Validity

Status: Completed on 2026-06-24

Deliverables:

- Codex native projection removes unsupported `service_tier` values instead of
  carrying invalid native config forward.
- Codex wrapper prefers the npm `codex.cmd` launcher on Windows before other
  PATH entries.
- Codex wrapper ignores the known non-fatal skills-budget diagnostic while
  preserving real error events.
- Architecture docs record the native config validity and diagnostic
  classification boundaries.

Verification:

- `bun run --cwd packages/cli test -- tests/config/native-permission-projection.test.ts`
- `bun run --cwd packages/cli test -- tests/wrapper/codex-session.test.ts`
- `bun run typecheck` in `packages/cli`
- full `packages/cli` test suite
- live Kiln-vs-native Codex comparison on `gpt-5.4` with low and medium
  reasoning

### Slice 2 - Model Readiness Probe

Status: Completed on 2026-06-24

Deliverables:

- Add a provider-owned readiness probe that distinguishes "CLI installed" from
  "selected model runnable".
- Record model readiness failures such as Codex returning that a model requires
  a newer CLI/app version.
- Surface the result through provider discovery without adding static fallback
  model lists.
- Preserve the current fail-closed rule: a selected model that cannot be proven
  runnable is not admitted for execution.

Verification:

- `bun run --cwd packages/runtime test -- tests/gateway/gui-gateway.test.ts`
- `bun run --cwd packages/cli test -- tests/wrapper/codex-session.test.ts`
- `bun run --cwd packages/cli test -- tests/commands/run-builtin-tools.test.ts`
- `bun run --cwd packages/gateway-contracts typecheck`
- `bun run --cwd packages/runtime typecheck`
- `bun run --cwd packages/cli typecheck`
- Live source `kiln run` comparison against native `codex exec` on
  `gpt-5.5` with medium reasoning.

Progress:

- Codex CLI discovery and wrapper execution now classify "model requires a
  newer version of Codex" as `model_version_unsupported` /
  `CODEX_MODEL_VERSION_UNSUPPORTED` instead of generic endpoint or turn
  failure.
- `kiln run` now validates explicit Codex/OpenCode wrapper models through
  shared CLI discovery before session execution, while preserving native
  harness defaults when no explicit wrapper model is selected.
- Live Codex source execution and native Codex execution both proved
  `gpt-5.5` runnable on 2026-06-24; the globally installed `kiln` command was
  observed to point at an older Bun shim and is intentionally tracked as
  installation-health work rather than hidden wrapper fallback.

### Slice 3 - Harness Doctor

Status: Completed on 2026-06-24

Deliverables:

- Add a read-only `kiln doctor` view for local harness installation health.
- Report resolved executable path, all competing PATH entries, detected
  versions, auth state, config projection state, and supported model probe
  evidence.
- Treat competing aliases as warnings when the canonical executable resolves
  first, not as execution failures.
- Reuse shared config/status read models; do not make a CLI-only diagnostic
  path.
- Treat global `kiln` drift as release/install evidence. Do not update the
  global command during local development; it will move when a release installs
  a new build.

Verification:

- `bun run --cwd packages/cli test -- tests/application/harness-doctor.test.ts tests/commands/doctor.test.ts`
- `bun run --cwd packages/cli typecheck`
- `bun run --cwd packages/runtime typecheck`
- `bun run --cwd packages/runtime build`
- `bun run --cwd packages/cli build`
- Live source `kiln doctor`
- Live source `kiln doctor --json`

Progress:

- `kiln doctor` now reports local Kiln, Codex, and OpenCode executable
  resolution, versions, PATH competitors, provider discovery status, auth
  state, model evidence, and config projection state.
- The command is read-only. It exposes `repairActions: []` in JSON and does not
  mutate PATH, native config, package installs, or global shims.
- Global `kiln` drift is reported as release/install evidence. The global
  command remains unchanged until a release installs a new build.

## Gates

- No wrapper-local hidden fallback to another Codex binary after admission.
- No static model fallback lists.
- No automatic uninstall or PATH mutation.
- No app-vs-CLI preference encoded outside the harness health contract.
- No surface-specific readiness logic outside shared config/status contracts.

## Research Basis

- OpenAI documents Codex on Windows as app, CLI, and IDE extension surfaces:
  `https://developers.openai.com/codex/windows`
- OpenAI documents the Codex app as a separate desktop experience:
  `https://developers.openai.com/codex/app`
- The Codex repository documents Windows CLI installation and npm global
  installation:
  `https://github.com/openai/codex`
- npm documents that global Windows executables are linked into the global
  prefix, commonly `%AppData%\npm`:
  `https://docs.npmjs.com/cli/v9/configuring-npm/folders/`
- Microsoft WinGet documents installed app listing and upgrade behavior:
  `https://learn.microsoft.com/en-us/windows/package-manager/winget/list`
- NIST configuration management frames configuration as initializing,
  changing, and monitoring product/system integrity through the lifecycle:
  `https://csrc.nist.gov/glossary/term/configuration_management`
- SLSA and TUF support the broader supply-chain posture: artifact provenance,
  trusted update paths, and explicit update integrity matter for local tooling:
  `https://slsa.dev/`, `https://theupdateframework.io/`
