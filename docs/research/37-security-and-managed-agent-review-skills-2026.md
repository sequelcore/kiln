# Security and Managed-Agent Review Skills (2026)

Status: accepted research basis
Cutoff: 2026-08-12

## Decision

Kiln's security and managed-agent review skills must test enforceable authority,
not prompt intent. Security review owns principals, assets, trust boundaries,
untrusted-data transitions, credentials, and consequential effects. Managed-agent
review specializes that contract for delegated identity, attenuated capability,
lifecycle settlement, evidence integrity, and handoff admission.

Neither a refusal instruction, a clean dependency graph, nor a child summary is
proof of authorization. Missing, unsupported, unavailable, and contradictory
evidence remain distinct outcomes.

## Evidence

Measured evidence:

- [AgentDojo](https://proceedings.nips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html)
  evaluates 97 tasks and 629 security cases and shows that indirect prompt
  injection remains effective against tool-using agents; none of its evaluated
  defenses is universal.
- [InjecAgent](https://aclanthology.org/2024.findings-acl.624/) independently
  demonstrates indirect-injection risk in tool-integrated agents.
- [CaMeL](https://arxiv.org/abs/2503.18813) separates trusted control flow from
  untrusted data and reports useful task completion under formal assumptions.
  Its guarantee is limited to those assumptions and supported operations.
- Anthropic reports a 90.2% improvement for one internal multi-agent research
  evaluation while also documenting coordination, cost, and reliability
  challenges. This is provider- and task-specific, not evidence that delegation
  is generally superior. [Engineering report](https://www.anthropic.com/engineering/multi-agent-research-system)

Authoritative and emerging guidance:

- [NIST SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final) supports
  granular identity-based policy decision and enforcement without implicit
  trust.
- OWASP recommends least privilege, per-tool authorization, input/output
  validation, monitoring, human review for consequential actions, secrets
  lifecycle controls, and non-disclosing public errors.
  [Agent security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html),
  [prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html),
  [secrets](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html),
  [errors](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html).
- The 2026 NIST agent-identity initiative covers identification, authorization,
  audit, and non-repudiation but remains an emerging concept, not a final
  standard. [Announcement](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents)
- A2A provides task/context identity and lifecycle concepts but does not promise
  complete retained history. MCP forbids token passthrough and requires audience
  validation. OpenTelemetry supplies observability vocabulary but warns that
  arguments and results may contain sensitive content.
  [A2A specification](https://a2a-protocol.org/latest/specification/),
  [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization),
  [OpenTelemetry GenAI](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/).

## Adopted contract

Security review:

- maps principals, assets, trust zones, inputs, effects, and blast radius;
- traces input through interpretation, policy enforcement, effect, and audit;
- requires an external enforcement point to validate identity, delegated scope,
  resource, operation, parameters, current policy, and revocation state;
- traces credentials and sensitive data through prompts, processes, tools, logs,
  errors, storage, and output;
- treats every model-produced or external value as untrusted at an effect
  boundary and requires denial or explicit approval when authority is unclear;
- reports severity, trigger path, impact, evidence, correction, reviewed surface,
  verification, and residual risk.

Managed-agent review:

- binds child, task, attempt, lineage, route, capability, data, authority, budget,
  timeout, and policy identity in an immutable admission snapshot;
- permits delegation only to attenuate authority and re-authorizes effects;
- tests cancellation, revocation, retries, idempotency, recovery, capacity, and
  unknown settlement;
- preserves ordered, integrity-bound, redacted lifecycle and artifact evidence;
- distinguishes audit reconstruction from deterministic re-execution;
- validates child output as untrusted and reports adapter limitations honestly.

## Limitations

Agent-security benchmarks cover constrained environments and age quickly.
Standards cover different portions of the problem; none establishes complete
agent authorization or replay. These sources support Kiln's threat hypotheses
and evidence requirements, not a claim that the resulting checklist guarantees
security.
