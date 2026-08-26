# Formal Screening Package Format

Private packages use `private-formal-screening-v1` and live only below the
repository's ignored `.kiln-private/benchmarks` boundary. `manifest.json`
declares case IDs, paired arms, candidate and hidden-test roots, allowed changed
paths, exact digests, counts, and LemmaScript bindings.

The loader rejects path escapes, symlinks/junctions, special files, overlapping
public/private roots, unexpected case counts, and digest drift before leasing a
sanitized workspace. Package contents are test inputs, never public release
artifacts or canonical product configuration.
