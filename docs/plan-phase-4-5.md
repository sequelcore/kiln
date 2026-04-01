# Phase 4.5 Implementation Plan: Permission & Safety

> Generated: 2026-04-01. Sources: claude-code, codex, opencode, codex-plugin-cc, hermes-agent scouts + local Kiln codebase analysis.

## Objective

Phase 4.5 makes Kiln's permission model granular and safer without breaking existing `kiln.yaml` users. The implementation must:

- Extend `KilnPermissionPolicy` beyond `{ approval, sandbox }`
- Keep `translatePermission()` as the single backend translation point
- Push native per-tool rules where supported
- Degrade gracefully where a backend cannot enforce a rule natively
- Add privacy-first `--safe-defaults`
- Close known prompt-injection bypasses in `packages/core/src/safety/`
- Connect permission denials to the safety pipeline for auditable enforcement

This phase is implemented as four ordered sub-phases: `4.5a` through `4.5d`.

---

## 1. Extended `KilnPermissionPolicy`

### Design goals

- Backward-compatible with current shape `{ approval, sandbox }`
- Explicit separation between:
  - coarse execution mode
  - tool permissions
  - shell command permissions
  - file/context governance
  - data egress policy
  - per-agent scoping
- Serializable from `kiln.yaml`
- Translatable to Claude Code, Codex CLI, and OpenCode without leaking backend-specific concepts

### Proposed TypeScript type

Add to `packages/cli/src/wrapper/session.ts`:

```ts
export type KilnPermissionAction = "allow" | "ask" | "deny";

export type KilnPermissionApproval =
  | "never"
  | "on-request"
  | "on-failure"
  | "untrusted";

export type KilnSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type KilnToolPermissionRule = {
  tool: string;
  action: KilnPermissionAction;
  reason?: string;
};

export type KilnCommandPermissionRule = {
  pattern: string;
  action: KilnPermissionAction;
  shell?: "bash" | "sh" | "zsh" | "any";
  reason?: string;
};

export type KilnFileGovernancePolicy = {
  denyGlobs?: string[];
  askGlobs?: string[];
  allowGlobs?: string[];
  excludeFromContext?: boolean;
};

export type KilnDataDestination =
  | "small-model"
  | "logs"
  | "ci"
  | "github-actions"
  | "external-mcp"
  | "webhook";

export type KilnDataFirewallRule = {
  destination: KilnDataDestination | string;
  action: "allow" | "redact" | "deny";
  classifications?: string[];
  reason?: string;
};

export type KilnAgentPermissionScope = {
  agent: string;
  inherit?: boolean;
  tools?: KilnToolPermissionRule[];
  commands?: KilnCommandPermissionRule[];
  fileGovernance?: KilnFileGovernancePolicy;
  mcpTools?: string[];
};

export type KilnPermissionPolicy = {
  approval?: KilnPermissionApproval;
  sandbox?: KilnSandboxMode;

  safeDefaults?: boolean;
  auditLog?: boolean;

  tools?: KilnToolPermissionRule[];
  commands?: KilnCommandPermissionRule[];
  fileGovernance?: KilnFileGovernancePolicy;
  dataFirewall?: KilnDataFirewallRule[];
  agentScopes?: KilnAgentPermissionScope[];
};
```

### Opinionated defaults

- `safeDefaults` defaults to `false` at schema level (backward compatibility)
- `auditLog` defaults to `true` when `safeDefaults=true`
- `excludeFromContext` defaults to `true` when `safeDefaults=true`
- `tools`, `commands`, `dataFirewall`, `agentScopes` default to `[]`

### Compatibility rule

Existing configs with only:

```yaml
permissions:
  approval: on-request
  sandbox: workspace-write
```

must behave exactly as today. New fields are additive only.

---

## 2. `kiln.yaml` Schema Extension

### Files

- `packages/cli/src/kiln-yaml-types.ts`
- `packages/cli/src/kiln-yaml.ts`
- `packages/cli/src/commands/config.ts`

### Schema changes

Extend the `permissions` block to support:

- `safeDefaults: boolean`
- `auditLog: boolean`
- `tools: [{ tool, action, reason? }]`
- `commands: [{ pattern, action, shell?, reason? }]`
- `fileGovernance: { denyGlobs?, askGlobs?, allowGlobs?, excludeFromContext? }`
- `dataFirewall: [{ destination, action, classifications?, reason? }]`
- `agentScopes: [{ agent, inherit?, tools?, commands?, fileGovernance?, mcpTools? }]`

### Full example `kiln.yaml`

```yaml
permissions:
  approval: on-request
  sandbox: workspace-write
  safeDefaults: true
  auditLog: true

  tools:
    - tool: "Read"
      action: allow
    - tool: "Glob"
      action: allow
    - tool: "Grep"
      action: allow
    - tool: "Edit"
      action: ask
    - tool: "Bash(git:*)"
      action: ask
    - tool: "Bash(curl:*)"
      action: deny
      reason: "No network egress from local agents"

  commands:
    - pattern: "git status*"
      action: allow
    - pattern: "git diff*"
      action: allow
    - pattern: "rm *"
      action: ask
    - pattern: "curl *"
      action: deny
    - pattern: "gh secret *"
      action: deny

  fileGovernance:
    excludeFromContext: true
    denyGlobs:
      - "**/.env"
      - "**/.env.*"
      - "**/*.pem"
      - "**/*.key"
      - "**/id_rsa"
      - "**/id_ed25519"
      - "**/.npmrc"
      - "**/.pypirc"
      - "**/.docker/config.json"
      - "**/.aws/**"
      - "**/.ssh/**"
      - "**/.gnupg/**"
      - "**/secrets/**"
    askGlobs:
      - "**/.env.example"
      - "**/*.example"

  dataFirewall:
    - destination: logs
      action: redact
      classifications: ["pii", "secret", "credential"]
    - destination: ci
      action: deny
      classifications: ["secret", "credential"]
    - destination: small-model
      action: deny
      classifications: ["secret", "credential", "token"]

  agentScopes:
    - agent: "planner"
      inherit: true
      tools:
        - tool: "Read"
          action: allow
        - tool: "Edit"
          action: deny
      mcpTools:
        - "memory.read"
        - "knowledge.search"
    - agent: "worker"
      inherit: true
      tools:
        - tool: "Edit"
          action: ask
        - tool: "Bash(git push:*)"
          action: deny
```

### Validation rules

- `tool` and `pattern` are required non-empty strings
- `action` must be `allow | ask | deny`
- `denyGlobs`, `askGlobs`, `allowGlobs`, `mcpTools`, `classifications` must be string arrays
- `agent` is required and case-sensitive
- Reject duplicate agent scope names
- Do not reject unknown `destination` values — preserve extensibility
- Normalize empty arrays to `[]`
- Unknown keys in `permissions` warn, not hard fail

### `commands/config.ts` extension

Extend config key handling to support:

- `permissions.safeDefaults`
- `permissions.auditLog`
- `permissions.tools`
- `permissions.commands`
- `permissions.fileGovernance`
- `permissions.dataFirewall`
- `permissions.agentScopes`

Array mutation by index is **not required** in this phase. Full object replacement is sufficient:

```bash
kiln config set permissions.tools '[...]'
```

---

## 3. `translatePermission()` Extension

### File

- `packages/cli/src/wrapper/session-registry.ts`

### Architectural rule

`translatePermission()` remains the **only** place that converts `KilnPermissionPolicy` into backend-native permission config. Do not spread translation logic into sync or session startup code.

### Proposed output type

```ts
type TranslatedPermissions = {
  kiln: RequiredNormalizedPermissionPolicy;
  claude: {
    permissionMode: string;
    allow: string[];
    deny: string[];
    extraInstructions: string[];
  };
  codex: {
    approval_policy: string;
    sandbox_mode: string;
    extraInstructions: string[];
  };
  opencode: {
    permissionDefault: "ask" | "allow" | "deny";
    permissions: Record<string, "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">>;
    extraInstructions: string[];
  };
};
```

### Translation strategy by backend

#### Claude Code

Native support: `permissionMode`, per-tool allow/deny arrays in `settings.json`, `Bash(...)` command patterns.

Mapping:

- `tools[].tool` → Claude permission rule strings directly
- `commands[].pattern` → `Bash(<pattern>)`
- `allow` action → `allow` array
- `deny` action → `deny` array
- `ask` action → omit (handled by default mode)

When `safeDefaults=true`, inject Claude dangerous files/directories into deny rules:
- `.git/**`, `.claude/**`, `.vscode/**`, `.idea/**`
- `.gitconfig`, `.bashrc`, `.zshrc`, `.ripgreprc`, `.mcp.json`, `.claude.json`

File governance is also mirrored as session instructions:
> "Do not read, quote, summarize, or modify files matching [globs]"

#### Codex CLI

Native support: `approval_policy`, `sandbox_mode` **only**. No per-tool allowlist (open feature request #3821). No file exclusion (open feature requests #2847, #1397).

Mapping:

- Coarse policy translates as today
- Granular rules → `extraInstructions` (injected into Kiln preamble at session start)

Preamble sections to generate:
- Tool rules summary: `ALLOW tool: Read`, `DENY tool: Bash(curl:*)`
- Shell command rules: `DENY command pattern: curl *`
- File governance: `DENY file access/context inclusion for glob: **/.env`
- Agent scope summary: `Subagent planner may use: Read, Glob. Must not use: Edit.`

This must be **deterministic and machine-generated**, not prose assembled ad hoc in command handlers.

#### OpenCode

Native support: 16 per-tool permission fields, pattern maps, live PATCH /config.

Tool name mapping (Kiln → OpenCode):

| Kiln | OpenCode |
|------|----------|
| `Read` | `read` |
| `Edit` | `edit` |
| `Glob` | `glob` |
| `Grep` | `grep` |
| `List` | `list` |
| `Bash` / `Bash(...)` | `bash` |
| `Task` | `task` |
| `WebFetch` | `webfetch` |
| `WebSearch` | `websearch` |
| `CodeSearch` | `codesearch` |
| `LSP` | `lsp` |
| `Skill` | `skill` |
| `Question` | `question` |
| `TodoWrite` | `todowrite` |
| `ExternalDirectory` | `external_directory` |

Pattern translation:
- Exact tool-level action → scalar field
- Command rules → `bash: { "<pattern>": "<action>" }`
- If both scalar and pattern map exist, use pattern object form
- Preserve OpenCode last-match-wins semantics by writing rules in declared order

File governance:
- `denyGlobs` and `askGlobs` → additional maps on `read`, `edit`, `grep`, `glob`, `list`
- `safeDefaults=true` must **augment** not overwrite OpenCode built-in `*.env` handling

### Normalization step

Before backend translation, add a normalization function:

- Apply `safeDefaults` base policy
- Merge user rules over defaults (last declaration wins)
- Deduplicate exact duplicate rules
- Normalize `Bash(...)` representations
- Expand file governance to explicit effective deny/ask set

Implement in `session-registry.ts` or a sibling helper under `packages/cli/src/wrapper/`.

---

## 4. `syncPermissions()` Extension

### File

- `packages/cli/src/sync/security-sync.ts`

### Responsibilities

`syncPermissions()` remains a merge-oriented config synchronizer, not a policy engine. It consumes translated permissions and writes backend config in a backend-safe way.

### Claude Code writes

Continue writing to `settings.json`:
- `permissionMode`
- `allow`
- `deny`

New behavior:
- Merge Kiln-managed allow/deny entries without deleting unrelated user settings
- Deterministic overwrite of Kiln-owned keys only

### Codex CLI writes

Continue writing to `config.toml`:
- `approval_policy`
- `sandbox_mode`

New behavior:
- Do **not** attempt fake unsupported config keys
- Granular rules go to session bootstrap preamble only, not `config.toml`

### OpenCode writes

Continue writing to `opencode.json`:
- `permission.default`
- Per-tool permission keys
- Pattern maps for `bash`, `read`, `edit`, `grep`, `glob`, `list`

Per-agent scoped adjustments: session startup PATCH `/config` at runtime (not static sync).

### File governance writes by backend

- Claude: indirect via allow/deny where representable + session instructions
- Codex: not persisted; enforce through session preamble + safety checks
- OpenCode: persist as permission maps on file-touching tools

### Fail-open rule

- Unsupported rules emit warning-level logging
- Coarse permissions always sync
- Backend config sync must not abort because one granular rule cannot be represented natively

### Audit log

Add a Kiln-side audit sink under `packages/cli/src/wrapper/`:
- Log effective normalized policy at session start
- Log denied or auto-approved actions with source: `backend-native`, `kiln-preamble`, or `safety-pipeline`

Do not bury audit logic inside `security-sync.ts`.

---

## 5. `--safe-defaults` Preset

### CLI surface

```bash
kiln run --safe-defaults
```

Sets `permissions.safeDefaults=true` for the session **without** mutating `kiln.yaml` unless explicitly persisted.

### Effective preset

#### Coarse defaults

```ts
{
  approval: "on-request",
  sandbox: "workspace-write",
  safeDefaults: true,
  auditLog: true
}
```

Rationale: `read-only` is too restrictive for practical orchestration. `workspace-write` avoids friction while blocking full host access. `on-request` preserves human review for risky actions.

#### Tool defaults

```ts
[
  { tool: "Read", action: "allow" },
  { tool: "Glob", action: "allow" },
  { tool: "Grep", action: "allow" },
  { tool: "List", action: "allow" },
  { tool: "LSP", action: "allow" },
  { tool: "CodeSearch", action: "allow" },
  { tool: "Edit", action: "ask" },
  { tool: "Task", action: "ask" },
  { tool: "Bash", action: "ask" },
  { tool: "WebFetch", action: "deny" },
  { tool: "WebSearch", action: "deny" },
  { tool: "ExternalDirectory", action: "deny" }
]
```

#### Command defaults

```ts
[
  { pattern: "git status*", action: "allow" },
  { pattern: "git diff*", action: "allow" },
  { pattern: "git log*", action: "allow" },
  { pattern: "git show*", action: "allow" },
  { pattern: "bun test*", action: "ask" },
  { pattern: "npm test*", action: "ask" },
  { pattern: "rm *", action: "ask" },
  { pattern: "mv *", action: "ask" },
  { pattern: "cp *", action: "ask" },
  { pattern: "curl *", action: "deny" },
  { pattern: "wget *", action: "deny" },
  { pattern: "gh auth *", action: "deny" },
  { pattern: "gh secret *", action: "deny" },
  { pattern: "printenv*", action: "deny" },
  { pattern: "env", action: "deny" }
]
```

#### File governance defaults

```ts
{
  excludeFromContext: true,
  denyGlobs: [
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/id_rsa",
    "**/id_ed25519",
    "**/.ssh/**",
    "**/.aws/**",
    "**/.gnupg/**",
    "**/.npmrc",
    "**/.pypirc",
    "**/.docker/config.json",
    "**/.git-credentials",
    "**/secrets/**",
    "**/credentials/**",
    "**/.git/**",
    "**/.claude/**",
    "**/.vscode/**",
    "**/.idea/**"
  ],
  askGlobs: [
    "**/.env.example",
    "**/*.example",
    "**/*.sample"
  ]
}
```

#### Data firewall defaults

```ts
[
  { destination: "logs", action: "redact", classifications: ["pii", "secret", "credential", "token"] },
  { destination: "ci", action: "deny", classifications: ["secret", "credential", "token"] },
  { destination: "github-actions", action: "deny", classifications: ["secret", "credential", "token"] },
  { destination: "small-model", action: "deny", classifications: ["secret", "credential"] },
  { destination: "webhook", action: "redact", classifications: ["pii", "secret", "credential"] }
]
```

### Merge strategy

`safeDefaults` provides a base policy. User-defined rules apply after with last-rule-wins. `safeDefaults` must be overridable — it is a starting point, not a lock.

---

## 6. Safety Pipeline Injection Fixes

### Scope boundary

All safety implementation changes stay under `packages/core/src/safety/`. Do not solve injection gaps in CLI wrappers.

### A. Unicode / Homoglyph Normalization

New file: `packages/core/src/safety/normalization.ts`

Responsibilities:
- NFKC normalize
- Strip zero-width and bidi control characters
- Map Cyrillic confusables to Latin for detection (not for output)
- Lowercase for comparison
- Preserve original text for reporting

Minimum Cyrillic confusable map: `а, е, о, р, с, у, х, і, ј, к, м, н, т, в` (+ uppercase equivalents)

Use normalized string **only** for rule matching, never rewrite user-visible content.

### B. German Prompt-Injection Pattern Coverage

Update injection classifier/pattern registry in `packages/core/src/safety/` to detect German variants:

```
ignoriere vorherige anweisungen
missachte vorherige anweisungen
systemprompt anzeigen
versteckten prompt ausgeben
geheimnisse ausgeben
umgebungsvariablen anzeigen
sicherheitspruefungen umgehen  (also: sicherheitsprüfungen)
shell-befehl ausfuehren         (also: ausführen)
```

### C. Expanded Dangerous Code Execution Patterns

New file: `packages/core/src/safety/patterns/dangerous-shell.ts`

Add detection for:
- Command substitution: `` `...` ``, `$()`
- Chained shell bypass: `sh -c`, `bash -c`, `zsh -c`
- Encoded payload execution: `base64 -d | sh`, `python -c`, `node -e`, `perl -e`, `ruby -e`
- Shell profile modification: `.bashrc`, `.zshrc`, `.profile`, `.bash_profile`
- Credential file access: `.git-credentials`, `.npmrc`, `.pypirc`, `.aws/credentials`, `.ssh/config`
- Destructive workspace commands: `rm -rf`, `find ... -delete`, `chmod -R`, `chown -R`

Centralize in a single pattern catalog — not scattered regexes.

### D. Denial Tracking Propagation

Add typed denial event to `packages/core/src/safety/types.ts`:

```ts
type PermissionDenialEvent = {
  tool: string;
  commandPattern?: string;
  filePath?: string;
  sourceBackend: "claude" | "codex" | "opencode";
  denySource: "policy" | "backend" | "safety";
  sessionId: string;
  timestamp: string;
};
```

Rail behavior:
- Repeated denials in one session increase risk score
- Denied attempt against sensitive files upgrades to high severity
- Denied exfiltration attempt to `logs`, `ci`, or `small-model` produces structured alert

### E. Test Files to Update

Wherever adversarial tests live under `packages/core/src/safety/`, add:
- Cyrillic homoglyph bypass samples
- German injection samples
- Shell command substitution samples
- Safe false-positive controls (no regressions)

**Do not close this phase without adversarial regression coverage.**

---

## 7. Sub-Phase Breakdown

### 4.5a: Policy Model & YAML

**Scope:** Extend `KilnPermissionPolicy`, `kiln.yaml` schema/parsing, `commands/config.ts`, normalization + safe-default expansion.

**Files:**
- `packages/cli/src/wrapper/session.ts`
- `packages/cli/src/kiln-yaml-types.ts`
- `packages/cli/src/kiln-yaml.ts`
- `packages/cli/src/commands/config.ts`
- New: `packages/cli/src/wrapper/permission-normalizer.ts`

**Size:** M

**Tests:**
- Schema parsing (new fields)
- Backward compatibility with `{ approval, sandbox }`
- Safe-default merge behavior
- Last-rule-wins normalization

---

### 4.5b: Backend Translation & Sync

**Scope:** Extend `translatePermission()`, extend `syncPermissions()`, session-start injection for Codex/OpenCode scoped patches, audit logging.

**Files:**
- `packages/cli/src/wrapper/session-registry.ts`
- `packages/cli/src/sync/security-sync.ts`
- Session bootstrap files under `packages/cli/src/wrapper/`

**Size:** L

**Tests:**
- Claude translation → valid `permissionMode`, `allow`, `deny`
- Codex instruction rendering (preamble output)
- OpenCode permission map rendering
- Sync writes valid `settings.json`, `config.toml`, `opencode.json`
- Fail-open behavior on unsupported rules

---

### 4.5c: Safe Defaults, Agent Scoping & Data Firewall

**Scope:** `--safe-defaults` flag, per-agent scope narrowing at session start, file exclusion from context, data firewall checks, scoped MCP tool exposure.

**Files:**
- CLI command entrypoints that create sessions
- `packages/cli/src/wrapper/`
- MCP/session bootstrap code

**Size:** L

**Tests:**
- `--safe-defaults` changes session behavior without mutating project config
- Sensitive files excluded from context by default
- Subagents receive restricted tool subsets
- Denied destinations blocked or redacted
- Auto-approved actions logged

---

### 4.5d: Core Safety Hardening

**Scope:** Unicode normalization for detection, German injection patterns, dangerous shell pattern expansion, denial tracking propagation, adversarial regression tests.

**Files:**
- `packages/core/src/safety/` (all relevant files + new files)

**Size:** M

**Tests:**
- Normalization unit tests
- Adversarial: Cyrillic homoglyph bypasses
- Adversarial: German injection variants
- Regression: command substitution + encoded execution
- Denial event escalation

---

## 8. Dependency Order

```
4.5a → 4.5b → 4.5c → 4.5d
              ↑
         4.5d normalization/patterns can begin after 4.5a
         4.5d denial propagation waits on 4.5c denial event schema
```

1. `4.5a` first — defines canonical policy shape. Everything else depends on this contract.
2. `4.5b` second — must be built on normalized effective policy, not raw YAML.
3. `4.5c` third — depends on working translation/sync + effective policy model.
4. `4.5d` fourth — pattern work can begin after 4.5a; denial propagation waits on 4.5c.

---

## 9. Verification Criteria

### 4.5a done when
- `kiln.yaml` accepts all new `permissions` fields
- Old configs parse unchanged
- Normalized policy output is deterministic
- Safe-default expansion merges correctly with user overrides

### 4.5b done when
- Claude translation emits valid `permissionMode`, `allow`, `deny`
- Codex translation emits stable preamble instructions for unsupported granular rules
- OpenCode translation emits valid per-tool and pattern configs
- `syncPermissions()` writes only supported native fields per backend
- Unsupported granular rules do not break sync

### 4.5c done when
- `--safe-defaults` changes effective session behavior without rewriting project config
- Sensitive files are excluded from context by default
- Subagents receive only their scoped tools and MCP capabilities
- Policy-based auto-approvals are logged
- Data firewall prevents or redacts disallowed egress destinations

### 4.5d done when
- Cyrillic homoglyph prompt-injection test cases are caught
- German prompt-injection variants are caught
- Dangerous command execution patterns are caught
- Permission denial events are visible to safety rails and audit logs
- No regressions in existing safety classifiers

---

## 10. Worker Execution Notes

- Do not let workers invent backend-specific config fields. If a backend does not support a rule natively, render it into instructions or enforce it in Kiln.
- Do not duplicate translation logic in `syncPermissions()` or command handlers.
- Do not make `safeDefaults` non-overridable.
- Do not mix CLI permission code into `packages/core/src/safety/`.
- Do not ship file governance as read-only documentation — it must affect context inclusion, file-touching tools, or both.

## 11. Implementation Sequence for Workers

1. **Worker 1** → `4.5a`: policy types, YAML schema, config command, normalization tests
2. **Worker 2** → `4.5b`: translation matrix, backend sync, fail-open tests
3. **Worker 3** → `4.5c`: safe-defaults flag, agent scoping, data firewall, audit logging
4. **Worker 4** → `4.5d`: safety normalization, dangerous pattern expansion, adversarial tests
5. **Reviewer pass** → validate DDD boundaries, no cross-context imports

---

*Phase 4.5 is complete when: users can declare granular permission policy once, Kiln translates/enforces it safely across Claude/Codex/OpenCode, sensitive files stop flowing into agent context by default, and core safety closes the documented injection gaps with regression coverage.*
