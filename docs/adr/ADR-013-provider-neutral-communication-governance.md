# ADR-013: Provider-Neutral Communication Governance

## Status

Accepted

## Context

Response detail, interaction behavior, language, required evidence, and
artifact writing were previously expressed through unrelated prompts, skills,
provider options, and native harness settings. Similar native labels are not
equivalent: Codex separates `model_verbosity` and `personality`; Claude output
styles replace or extend a session system prompt; OpenCode forwards
provider-specific agent options. A shared label cannot prove shared behavior.

Broad brevity or personality prompts can also suppress findings, failures,
warnings, citations, approvals, residual risks, or next actions. Change prose
has a separate risk: a polished commit or pull request can make claims that are
not bound to the candidate diff and verification evidence.

## Decision

Core owns one `CommunicationIntent`, one deterministic precedence resolver,
and one `CommunicationResolution`. The intent keeps these axes separate:

- response detail: `provider-default | concise | standard | detailed`;
- an interaction profile identified by id, revision, and observable behaviors;
- explicit locale;
- required-content preservation obligations;
- artifact-contract and response-skill references;
- `deny | omit` behavior for unsupported native controls.

Precedence is safety/authority, user, artifact contract, response skill,
invocation, agent profile, project, global, then provider default. Required
content is additive: a lower-precedence preference cannot remove a mandatory
decision, finding, failure, warning, citation, approval requirement, residual
risk, verification result, or next action.

Resolution occurs after route selection and records provider, model, surface,
harness, capability revision, mechanism, exactness, semantic loss, and a
deterministic identity for every axis, including locale, required content,
artifact contracts, and response skills. Only revisioned capabilities may produce native
controls. Unsupported controls are denied or explicitly omitted; labels are
never silently approximated. Prompt fallback is admitted only with a named
model-specific evaluation and must be materialized in the effective-prompt
manifest before provider dispatch.

Locale and required-content preservation are explicit prompt-owned
obligations. Runtime adds them as the identified
`runtime-communication-contract` component. Native detail and personality
controls do not enter prompt text. No communication component is added for the
provider default.

Parents and managed children resolve independently. A child consumes its own
agent-profile and invocation intent; it does not inherit ambient parent
personality. Retry, fallback, restored-session, and direct-provider requests
carry the same resolved contract and final-request evidence.
Transported retry resolutions are identity-verified and retain their original
source authority rather than being parsed again as invocation authority.

Standalone projection uses the existing owned-file lifecycle. Codex may receive
revision-backed `model_verbosity` and translated `personality`; OpenCode agent
files may receive route-specific `textVerbosity`; Claude output styles are not
overwritten automatically. Invocation routes that cannot exactly transport an
intent fail before SDK/provider I/O under `deny`.

Commit and pull-request text uses typed evidence-bound renderers. Claims refer
to exact candidate revision, diff digest, linked work, verification, and
residual-risk evidence. The evidence bundle is embedded and revalidated so a
forged claim cannot pass a standalone validator. These artifact contracts are
not chat personality.

## Consequences

Core is the policy authority; CLI owns durable configuration and native
projection; Runtime owns per-route resolution and effective-prompt assembly;
adapters own capability-gated transport; Gateway, CLI, GUI, TUI, SDK, and
replay present shared content-free evidence without recomputing policy.

Claude output style and OpenCode invocation-scoped provider options remain
unsupported until Kiln can prove ownership, precedence, and exact transport.
No compatibility aliases or universal communication defaults are introduced.

## Verification

- Core tests cover vocabulary, precedence, additive obligations, deterministic
  identity, unsupported behavior, and native/prompt mechanisms.
- Runtime tests cover route selection, child-specific resolution, provider
  dispatch, retries/fallback evidence, and the identified prompt component.
- Harness tests cover Codex invocation overrides, owned agent-file projection,
  drift/rollback behavior, and pre-transport denial for unsupported routes.
- Shared contract tests cover content-free observation and presentation across
  live and replay surfaces.
- Artifact tests reject unbound claims and validate deterministic commit/PR
  output.

## Evidence

- OpenAI model guidance: <https://developers.openai.com/api/docs/guides/latest-model>
- Claude Code output styles: <https://code.claude.com/docs/en/output-styles>
- Claude Code subagents: <https://code.claude.com/docs/en/sub-agents>
- OpenCode agents: <https://opencode.ai/docs/agents/>
- OpenCode models: <https://opencode.ai/docs/models/>
- Delivery issue: <https://github.com/sequelcore/kiln/issues/77>
