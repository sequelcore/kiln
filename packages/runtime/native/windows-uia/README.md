# Kiln Windows UIA Sidecar

`kiln-windows-uia.exe` is Kiln's native Microsoft UI Automation helper for the
`windows-uia` computer-use provider. The TypeScript runtime owns policy,
allowlist checks, audit metadata, and tool contracts; this executable only
performs local UIA observation and semantic UI actions.

Build on Windows:

```cmd
packages\runtime\native\windows-uia\build.cmd
```

The build writes:

```text
packages\runtime\native\windows-uia\bin\kiln-windows-uia.exe
```

Runtime request protocol is JSON over stdin and JSON over stdout. Keeping the
typed text out of process arguments avoids leaking sensitive text through
process-list inspection.

Example request:

```json
{"operation":"observe","includeAccessibility":true,"maxDepth":4}
```

Set `KILN_WINDOWS_UIA_HELPER` only when the executable lives outside the default
runtime package path.
