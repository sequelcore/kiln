# ADR-015: Model-Facing Execution Authority

## Status

Accepted

## Context

Model-facing run, GUI, TUI, benchmark, native harness, direct-provider, managed
child, memory, and Tools MCP paths historically constructed or interpreted
permission policy independently. Missing configuration could become
`never/workspace-write`; a partial project object could erase global rules;
plan and agent layers could re-grant authority; remembered approval could
override denial; and Tools MCP applied configured policy only to memory.

Permission configuration and concrete action effects answer different
questions. Configuration determines what the operator admits. Core effect
classification determines the consequence of a resolved invocation. Combining
them into one generic engine would couple YAML ownership to executable effects
and weaken both boundaries.

## Decision

CLI configuration is the only producer of admitted model-facing permission
policy. The central root posture is `on-request/read-only`, with product safe
defaults and audit enabled. Explicit global policy may override an optional
product baseline. Project and agent policy, plan mode, parent capability, and
route capability are attenuators only. No execution surface owns a fallback or
constructs a policy literal.

Within one explicit operator-authored tool or command layer, canonical
last-match semantics are retained. Tool aliases are canonicalized before
deduplication, evaluation, projection, and fingerprinting. Across authority
layers, results meet restrictively: `deny` is stronger than `ask`, which is
stronger than `allow`; an absent child opinion is neutral. File policy keeps
its deny, ask, allow precedence. Memory grants and MCP tool sets intersect.
Sandbox takes the most restrictive value. Unmatched or unknown egress denies.

The current storage vocabulary is interpreted as follows during containment:
`allow` is admitted, `ask` requires consent, and `deny` is a hard prohibition.
An `ask` without a preventive live approval channel or an exact admitted grant
blocks before effect. A grant is evidence, never policy, and cannot satisfy a
hard denial. Slice 1 replaces this overloaded storage vocabulary with
`allow`, `require-approval`, and `forbid`, plus non-serializable internal
`neutral`; the old names are not retained as aliases.

Durable approval records from the old JSONL contract are not authority. They
lack policy fingerprint, project, caller, agent, expiry, and revocation
bindings and are ignored by execution. A future grant contract must bind all of
those values and defaults to session scope. Existing records may be archived or
discarded explicitly; Kiln does not silently delete operator state.

Plan mode is a ceiling, not a replacement policy. It may expose only its named
non-mutating tool set and cannot grant a tool denied by configured policy.
Agent scopes always inherit and meet with their parent; `inherit:false`
rejects. A child allow cannot re-grant a parent deny or unresolved approval.

Managed invocations receive a Runtime-owned caller capability derived from the
admitted parent turn, not a Kiln policy object. A nested invocation with missing
or unqualified parent authority rejects. Requested child authority above the
caller or route ceiling rejects rather than silently downgrading the recorded
request. Tool sets and boolean capabilities intersect.

Model-facing memory always enters Core with explicit governed authority. Its
root absence means read-only project-scoped access. Trusted internal memory is
unrestricted only through an explicit Core-owned trusted-internal boundary;
undefined is not authority.

Every concrete Tools MCP invocation meets configured admission, Core action
effect authorization, route capability, and any caller-supplied bound before
execution. An explicit descriptor attenuates and never preauthorizes. Command,
file, memory, MCP, and destination checks use resolved concrete input. With no
approval channel, approval-required work blocks.

Native and direct-provider routes declare what they can prevent before launch.
Prompt constraints, emitted tool events, and inferred observation receipts are
not preventive proof. When the admitted policy requires a restriction or
consent mechanism that the route cannot enforce before effect, route admission
rejects. Post-hoc observation remains defense-in-depth and evidence only.

Configured permission and concrete effect authorization are conjunctive.
Neither may grant what the other denied. Core effect classification remains
configuration-free and fails closed on malformed or unknown effects. Runtime
receives admitted authority; it does not parse YAML. Status uses the same
configured admission result as runtime and never presents a rejected raw merge
as effective.

## Complexity Disposition

The invariant is that no model-facing route executes beyond global, project,
mode, parent, route, and concrete-effect authority. A single generic policy
engine was rejected because ordered rules, grant sets, filesystem globs,
effects, and route capabilities have different owners and algebras. Surface
local defaults were also rejected because they duplicate policy authority.

The accepted permanent concepts are one configured-policy owner, one Runtime
caller attenuation boundary, one Core invocation-admission port, and explicit
memory caller classes. They remove surface defaults, whole-object permission
replacement, descriptor preauthorization, omission-based unrestricted memory,
and approval memory as an undeclared authority source.

## Consequences

Some formerly usable native routes reject when their granular restrictions are
not preventively representable. This is intentional; a warning cannot preserve
the invariant. Status and the later effective-config read model must name the
unsupported dimension and route rather than claim uniform enforcement.

The full typed configured/execution snapshots, field provenance, replacement
permission vocabulary, typed global authority bounds, and grant lifecycle are
owned schema/read-model work. Immediate containment
must not wait for those projections.

This decision is invalidated only by new preventive route evidence or a change
to the product security boundary. New evidence may make a route admissible; it
does not make prompt instructions or post-hoc observations authoritative.
