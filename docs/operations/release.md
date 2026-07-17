# Release Runbook

This is the canonical procedure for publishing Kiln workspace packages. A
release note is intent; the Git tag, successful publish workflow, npm registry
metadata, and provenance are publication evidence.

## Release Channels

| Version form | Git tag | npm dist-tag | Supported install documentation |
| --- | --- | --- | --- |
| Stable, for example `3.0.0` | `v3.0.0` | `latest` | Update only after registry verification |
| Prerelease, for example `3.0.0-beta.1` | `v3.0.0-beta.1` | `beta` | Keep the stable install until registry verification |

Never publish a prerelease with the `latest` dist-tag. Never describe a tag,
workflow run, package, or install command as available before registry
verification succeeds.

## Owners And Evidence

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

## 1. Admit The Candidate

1. Choose the exact SemVer version. A new candidate must not reuse a version
   already present on npm; same-version continuation is only the
   integrity-matching recovery path in section 6.
2. Confirm the roadmap has no unresolved blocker for the selected channel.
3. Update the candidate note with the intended scope and explicit exclusions.
4. Preserve historical release sections. Post-release work belongs under the
   new candidate or release heading, never under an older tag.
5. Confirm the publish workflow accepts the exact version form and maps a
   prerelease to its non-`latest` dist-tag.
6. Confirm npm trusted publishing authorizes the repository and
   `.github/workflows/publish.yml` for every package in the release cohort. The
   workflow requires GitHub OIDC `id-token: write`; token-based publication and
   an `NPM_TOKEN` fallback are forbidden.

For `3.0.0-beta.1`, the required Git tag is `v3.0.0-beta.1` and the required npm
dist-tag is `beta`.

## 2. Align The Package Graph

All public workspace packages must use the exact candidate version. Private
workspaces must not create an unpublished dependency edge in a public package.
Every internal `@kilnai/*` reference in a public package must use that exact
candidate version in the source manifest. `workspace:*`, moving ranges, and
compatibility ranges are rejected. The release tooling creates a staging copy
for legal-file injection and packaging without mutating source manifests.

Regenerate and commit the lockfile through Bun after manifest changes:

```bash
bun install
bun install --frozen-lockfile
```

Do not hand-maintain a package list or publish order in the workflow. The
release contract discovers the public `@kilnai/*` cohort and computes
dependency-first order from its manifests. Do not add a compatibility range for
an unpublished package.

## 3. Verify The Exact Commit

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
bun run release:validate --ref v3.0.0-beta.1
bun run release:pack --ref v3.0.0-beta.1
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

## 4. Review And Tag

Review the complete candidate diff and record the passing commit SHA. Create an
annotated tag only after all required checks pass:

```bash
git tag -a v3.0.0-beta.1 -m "Kiln 3.0.0-beta.1"
git show --stat v3.0.0-beta.1
git push origin v3.0.0-beta.1
```

Pushing the tag is the publication trigger. Do not push it as a rehearsal.
The workflow must run the canonical validate, pack, smoke, preflight, and
publish commands using npm trusted publishing through GitHub OIDC. It must not
inject `NPM_TOKEN`, mutate source manifests, or implement a second package
loop. Monitor it through completion and retain its commit, tag, bundle,
package, and provenance evidence.

## 5. Verify Registry State

Verify every package in the canonical release cohort, not only the CLI:

```bash
npm view @kilnai/cli@3.0.0-beta.1 version
npm view @kilnai/cli dist-tags --json
```

For a beta, the expected state is:

- `beta` resolves to `3.0.0-beta.1`;
- `latest` still resolves to the previously supported stable version;
- package metadata and provenance correspond to the tagged commit;
- a clean temporary project can install the exact beta version and start the
  intended CLI surface.

Only after this evidence exists may the candidate note become a published
prerelease record and beta installation commands be documented.

## 6. Close Or Recover

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
