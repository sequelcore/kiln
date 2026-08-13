# Release runbook

This is the canonical procedure for publishing Kiln workspace packages. A
release note is intent; the Git tag, successful publish workflow, npm registry
metadata, and provenance are publication evidence.

> **Current status:** no release candidate is authorized. The project is being
> validated from source and will adopt a new public name and new package
> coordinates before its next release. Do not create or push a version tag.
> Pushing a `v*` tag activates the publish workflow.

The versions in the channel table are formatting examples, not planned
versions. Before admitting a real candidate, replace the provisional project
name, package scope, documentation URLs, package discovery assumptions, and
registry verification commands throughout the repository.

## Release channels

| Version form | Git tag | npm dist-tag | Supported install documentation |
| --- | --- | --- | --- |
| Stable, for example `3.0.0` | `v3.0.0` | `latest` | Update only after registry verification |
| Prerelease, for example `4.0.0-beta.1` | `v4.0.0-beta.1` | `beta` | Keep the stable install until registry verification |

Never publish a prerelease with the `latest` dist-tag. Never describe a tag,
workflow run, package, or install command as available before registry
verification succeeds.

## Owners and evidence

- The release operator owns the candidate commit and tag.
- `scripts/release/` owns release identity parsing, package discovery,
  dependency order, staged manifests, tarball integrity, registry preflight,
  dist-tag policy, and idempotent publication.
- `.github/workflows/publish.yml` owns the trusted GitHub trigger and invokes
  the canonical release commands. It must not duplicate the package graph.
- Public `packages/*/package.json` manifests own package versions and
  dependency declarations consumed by the release contract.
- `docs/changelog.md` owns concise public history.
- `docs/releases/` owns the curated release or candidate note.
- `docs/roadmap/` owns unresolved product promotion gates.

Keep the release commit limited to release metadata, generated lockfile changes,
workflow changes, and documentation required for the selected version.

## 1. Admit the candidate

1. Choose the exact SemVer version. A new candidate must not reuse a version
   already present on npm; same-version continuation is only the
   integrity-matching recovery path in section 6.
2. Confirm the roadmap has no unresolved blocker for the selected channel.
3. Confirm the public name and package coordinates are final and that all
   release tooling, manifests, examples, and registry checks use them.
4. Confirm the required live-provider and supported-platform evidence is
   complete.
5. Update the candidate note with the intended scope and explicit exclusions.
6. Preserve historical release sections. Post-release work belongs under the
   new candidate or release heading, never under an older tag.
7. Confirm the publish workflow accepts the exact version form and maps a
   prerelease to its non-`latest` dist-tag.
8. Confirm npm trusted publishing authorizes the repository and
   `.github/workflows/publish.yml` for every package in the release cohort. The
   workflow requires GitHub OIDC `id-token: write`; token-based publication and
   an `NPM_TOKEN` fallback are forbidden.

In the commands below, replace `<tag>` with the admitted `v`-prefixed tag,
`<package-name>` with a package from the final public scope, and `<version>`
with the exact SemVer candidate.

## 2. Align the package graph

All public workspace packages must use the exact candidate version. Private
workspaces must not create an unpublished dependency edge in a public package.
Every internal reference in the final public package scope must use that exact
candidate version in the source manifest. `workspace:*`, moving ranges, and
compatibility ranges are rejected. The release tooling creates a staging copy
for legal-file injection and packaging without mutating source manifests.

Regenerate and commit the lockfile through Bun after manifest changes:

```bash
bun install
bun install --frozen-lockfile
```

Do not hand-maintain a package list or publish order in the workflow. The
release contract discovers the public package cohort and computes
dependency-first order from its manifests. Do not add a compatibility range for
an unpublished package.

## 3. Verify the exact commit

Start from a clean worktree at the commit that will be tagged:

```bash
git status --short
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
git diff --check
```

Then build and validate the canonical immutable release bundle:

```bash
bun run release:validate --ref <tag>
bun run release:pack --ref <tag>
bun run release:smoke --bundle .release/bundle
```

`release:pack` writes staged manifests only under `.release/stage` and writes
every tarball plus `.release/bundle/release-bundle.json` under
`.release/bundle`. It must not mutate a source package manifest. Inspect the
bundle manifest and tarball contents for:

- the exact version;
- built runtime files and type declarations;
- required README, license, and package metadata;
- no source-only secrets, local state, benchmark evidence, or unrelated
  workspace artifacts;
- resolvable internal dependency versions.

The CI-only `release:preflight` command validates the entire bundle against npm
before publishing any package. An absent `name@version` is publishable. An
existing version is resumable only when its registry SHA-512 integrity exactly
matches the verified local tarball; any mismatch fails closed.

## 4. Review and tag

Review the complete candidate diff and record the passing commit SHA. Create an
annotated tag only after all required checks pass:

```bash
git tag -a <tag> -m "Release <version>"
git show --stat <tag>
git push origin <tag>
```

Pushing the tag is the publication trigger. Do not push it as a rehearsal.
The workflow must run the canonical validate, pack, smoke, preflight, and
publish commands using npm trusted publishing through GitHub OIDC. It must not
inject `NPM_TOKEN`, mutate source manifests, or implement a second package
loop. Monitor it through completion and retain its commit, tag, bundle,
package, and provenance evidence.

## 5. Verify registry state

Verify every package in the canonical release cohort, not only the CLI:

```bash
npm view <package-name>@<version> version
npm view <package-name> dist-tags --json
```

For a beta, the expected state is:

- `beta` resolves to the exact admitted prerelease version;
- `latest` still resolves to the previously supported stable version;
- package metadata and provenance correspond to the tagged commit;
- a clean temporary project can install the exact beta version and start the
  intended CLI surface.

Only after this evidence exists may the candidate note become a published
prerelease record and beta installation commands be documented.

## 6. Close or recover

On success:

1. Change the candidate note status to published prerelease.
2. Replace the changelog candidate heading with the published version and date.
3. Add the verified beta install command where prerelease users are expected to
   find it. Keep stable installation on the stable version.
4. Record any remaining promotion obligations without rewriting historical
   release notes.

On failure:

- Stop the workflow before downstream publication when possible.
- Do not delete or move `latest` to conceal a bad prerelease.
- A retry may continue the same version only when every already-published
  `name@version` has registry integrity identical to its tarball in the
  previously verified complete bundle. `release:publish` skips that package and
  repairs or validates the intended dist-tag before continuing.
- If any existing integrity differs, the release fails closed. Deprecate the
  bad package when necessary, repair the graph, and use a new prerelease
  version; npm versions are immutable.
- If no package was published, fix the candidate and retag only according to
  repository tag policy.
- Record partial-publication evidence and verify every package before resuming.
