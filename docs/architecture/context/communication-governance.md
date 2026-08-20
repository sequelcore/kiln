# Communication Governance

Kiln resolves communication intent as data, not as a universal personality
prompt. Core owns the vocabulary and precedence; Runtime resolves after route
selection; provider and harness adapters translate only against revisioned
capabilities.

## Contract

`CommunicationIntent` contains response detail, an observable interaction
profile, locale, required-content obligations, artifact/skill references, and
unsupported behavior. `CommunicationResolution` binds that request to the
actual provider, model, surface, harness, capability revision, mechanism,
exactness, semantic loss, and deterministic identity.

The precedence order is:

1. safety and authority obligations;
2. explicit user requirements;
3. artifact contract;
4. admitted response skill;
5. invocation;
6. agent profile;
7. project;
8. global;
9. provider default.

Scalar preferences use the highest-precedence value. Required content and
response skills accumulate. Concision therefore cannot erase applicable
findings, failures, warnings, citations, approvals, verification, residual
risks, decisions, or next actions.

## Execution

Resolution happens after the effective route is known. Native controls require
provider/model capability evidence and an adapter that declares the matching
transport. Prompt fallbacks require a model-specific evaluation id and become
an attributed effective-prompt component before dispatch. Unknown capability
is unsupported, never an inferred mapping.

Explicit locale and required-content preservation are rendered by the single
Runtime prompt authority as `runtime-communication-contract`. The component's
content is sent but only hashes, token counts, provenance hashes, resolution,
and capability evidence are persisted. Provider default adds no component.
The resolution reports requested and effective values plus mechanism for
locale, required content, artifact contract, and response skills as well as
detail and interaction profile. Artifact and skill references are attributed
to their own precedence sources when they enter through a production request.

Every provider attempt carries its own resolution. The canonical
`effective_prompt_observed` event selects only the final actual provider
request; it does not fabricate evidence from an earlier failed attempt.

Managed children resolve their agent/invocation intent independently. Parent
ambient style is not inherited. Direct providers and native wrappers expose
the same content-free resolution to CLI diagnostics. A managed retry carries
the complete identity-verified resolution; it does not reclassify agent or
authority policy as invocation input. Standalone wrappers also record the
hash and component attribution for the exact final prompt sent to the harness.

## Harness Projection

- Codex: supported GPT-5 routes can project detail to `model_verbosity`.
  The canonical `friendly@v1` and `pragmatic@v1` behavior sets may project to
  `personality` with explicit semantic-loss evidence. An ID match with a
  different revision or behavior set is unsupported; `none` is not treated as
  an interaction profile.
- Claude Code: global `responseDetail: concise` projects to the built-in
  `outputStyle: "Concise"` in user settings. Kiln-launched SDK sessions pass
  the same value through inline settings. Both paths preserve Claude Code's
  coding instructions. The setting applies after `/clear` or a new session and
  affects the main conversation only; Claude subagents continue to use their
  own prompt. Other response-detail values remain unsupported until Claude
  exposes an equivalent native contract.
- OpenCode: owned agent files may project `textVerbosity` only for an admitted
  OpenAI GPT-5 route. Kiln does not treat the option as harness-neutral or
  mutate a persistent agent during a turn.

Owned native files retain install-state hashes, drift detection, backup, and
rollback behavior. Claude's global output-style projection owns only the
`outputStyle` field in `~/.claude/settings.json`; unrelated user settings remain
operator-owned. The install state also retains the content-free global to
project to agent communication resolution used to write each owned field or
file, and status reads that evidence. Conflicting unmanaged operator settings
are not overwritten without explicit force review.

## Artifact Contracts

Commit and pull-request renderers accept an exact evidence bundle: candidate
revision, diff digest, linked work, verification, residual risks, and claims
that reference those evidence ids. Validators reject unknown evidence and
recompute the embedded evidence identity even for independently reconstructed
artifacts. File inventories and test counts are evidence,
not completion claims.

## Surfaces

Gateway contracts own the strict content-free wire schema and presentation.
REST, generic WebSocket, tenant WebSocket, and harness ingress validate the
same request-intent schema before Runtime admission. GUI and TUI use the shared
presentation for live and replay events. SDK sends that request intent and
exposes the validated final-request observation as `communicationEvidence`;
CLI exposes the resolution in human and JSON diagnostics. Surfaces do not
resolve or reinterpret communication policy.

See [ADR-013](../../adr/ADR-013-provider-neutral-communication-governance.md)
and the [global configuration guide](../../guides/config/global-config.md).
