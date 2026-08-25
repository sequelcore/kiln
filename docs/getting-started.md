# Getting started from source

This tutorial takes you from a clean checkout to a verified Kiln CLI. It does
not require a provider account, API key, or installed agent harness.

## Before you begin

Kiln is under active development and currently supported only from source.
There is no supported package installation for this repository state. The
current project name and `@kilnai/*` package coordinates are provisional.

You need:

- Git;
- Bun 1.4.0, matching `packageManager` in the root `package.json` and CI, for
  repository commands and short-lived CLI execution; and
- Windows 11 x64 and PowerShell or another Windows shell.

The verified source candidate is branch `dev`. Issue
[#103](https://github.com/sequelcore/kiln/issues/103) will record the exact
supported commit after its final operator-local cleanup gate closes. macOS and
Linux remain unadmitted until they pass the same clean-source gates; do not
infer support from portable unit fixtures or CI syntax.

The persistent Model Gateway does not inherit that ambient Bun as its service
host. The current source-only Windows preview can adopt the operator's one
already-verified mitigation into a Kiln-owned content-addressed store. This is
an operator-local migration, not an installation step for future users. Public
packaging is blocked until Kiln carries the exact platform artifact itself;
operators do not replace their workstation Bun or install a moving canary.

Provider-backed execution has additional credentials and harness requirements,
but they are not needed for this tutorial.

## Clone the repository

```bash
git clone --branch dev https://github.com/sequelcore/kiln.git
cd kiln
git rev-parse HEAD
```

Compare the printed revision with the exact commit recorded in issue #103 once
that issue is closed. Do not rely on the repository default branch, a moving
`dev` head, an unpublished tag, or an `@kilnai/*` package version. All remaining
commands run from the repository root unless stated otherwise.

## Run commands from source

Other guides use `kiln` as the concise name of the CLI command. Until a new
package release exists, run those commands from the project you want to operate
and substitute the source entrypoint:

```text
bun "<kiln-checkout>/packages/cli/src/index.ts" <command-and-arguments>
```

`<kiln-checkout>` is the absolute path to this repository. Keeping your shell
in the target project preserves project discovery; using `bun --cwd` would
change it.

## Install the workspace

```bash
bun install --frozen-lockfile
```

`--frozen-lockfile` makes the install fail if `package.json` and `bun.lock`
disagree. This is the same installation mode used by CI.

## Run the CLI safely

```bash
bun packages/cli/src/index.ts --help
```

You should see `Kiln -- Governed AI control-plane CLI` followed by the command
catalog. This command proves that Bun can resolve and execute the source CLI
without reading provider credentials or starting a local service.

> [!NOTE]
> Do not append `--help` to an arbitrary subcommand and assume that it is
> side-effect free. Some commands perform their normal read-only inspection
> when invoked that way. Use the root help command for this first check.

## Verify the type graph

```bash
bun run typecheck
```

This checks the shared contracts, core, runtime, SDK, CLI, operator surfaces,
and repository scripts. A successful command exits with status 0 and no
TypeScript errors.

## Run the broader gates

Before submitting a change, run the gates justified by the affected surface.
The complete deterministic baseline is:

```bash
bun run test
bun run build
```

Use `bun run test`, not `bun test`. The repository script runs the configured
Vitest suites with the required package isolation; Bun's built-in test runner
does not represent the project test contract.

Some browser and live-provider checks are intentionally separate because they
require installed browsers, credentials, quota, or native harnesses. The
contributing guide names those gates and when they apply.

The admitted local source surfaces are CLI, TUI, and GUI. Normal GUI startup is
loopback-only. Provider credentials are optional and are not part of clean
setup. Genuine permission attestation is currently exact only for Codex
app-server `0.149.1`; Claude Code and OpenCode do not expose the same proof.
Unattended/background/nested trusted execution, remote GUI exposure, and full
live-provider matrix coverage are explicit exclusions.

## Choose what to do next

### Learn the product

Read [Core concepts](concepts.md), then use the
[architecture index](architecture/README.md) to go deeper. You do not need to
read every architecture document before trying a surface.

### Inspect available commands

Use the root command catalog:

```bash
bun packages/cli/src/index.ts --help
```

Commands that inspect native harnesses or machine-global configuration may
report local state. Read the relevant guide before running commands that sync,
install, start, stop, or uninstall projections and services.

### Explore an application example

Start with the [example index](examples/README.md). Each example states its own
provider, credential, and environment requirements. Do not commit real secrets
to example YAML or `.env` files.

### Contribute

Read [Contributing](../CONTRIBUTING.md) for repository boundaries, commands,
and pull-request expectations. For prose, navigation, examples, or references,
also read the [documentation guide](contributing/documentation.md).

### Configure native harness integration

Read [Model Gateway operations](operations/model-gateway.md) before projecting
Kiln models into Codex, Claude Code, or OpenCode. The Model Gateway changes
native client configuration and runs a user-scoped loopback service, so its
lifecycle and restore rules matter.

## Get help

- Use the [documentation index](README.md) to find task and reference pages.
- Check the [FAQ](faq.md) for product and repository questions.
- Open a GitHub issue with reproducible commands, expected behavior, actual
  behavior, operating system, and the relevant commit.
