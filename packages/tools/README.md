# @kilnai/tools

Platform-aware resolver for Kiln vendored developer tool binaries.

This package resolves candidate platform packages and concrete binary paths for
vendored developer tools. It does not execute binaries and never reports a
vendored tool unless the platform package declares it in `tools.json` and
contains the expected `bin/<tool>` file (`bin/<tool>.exe` on Windows).

Materialized native tools:

| Tool | Version | Platforms |
|------|---------|-----------|
| `rg` | 15.1.0 | win32-x64, linux-x64, darwin-arm64, darwin-x64 |
| `fd` | 10.4.2 | win32-x64, linux-x64, darwin-arm64 |
| `jq` | 1.8.2 | win32-x64, linux-x64, darwin-arm64, darwin-x64 |

Tools are vendored from upstream release artifacts with SHA-256 verification
through:

```sh
bun run vendor:tools
```

The platform package `tools.json` file is the local authority for source URL,
archive path, extracted binary path, version, and checksum. Do not add binary
files by hand; update the manifest and rerun the vendoring script.
