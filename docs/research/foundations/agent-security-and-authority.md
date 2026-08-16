# Agent Security and Authority

Evidence cutoff: 2026-08-12.

This foundation preserves the evidence behind Kiln's security and managed-agent
review procedures. Current behavior belongs to
[`safety.md`](../../architecture/safety/safety.md),
[`credential-governance.md`](../../architecture/safety/credential-governance.md),
and the managed-agent contracts in
[`coordination.md`](../../architecture/coordination/coordination.md).

The durable finding is a boundary, not a checklist: security review must test
enforceable authority, never stated intent. A refusal instruction, a clean
dependency graph, and a child summary are each compatible with an unauthorized
effect.

## Injection is not solved by instruction

AgentDojo evaluates 97 tasks and 629 security cases and shows indirect prompt
injection remains effective against tool-using agents, with none of its
evaluated defenses universal. InjecAgent independently demonstrates
indirect-injection risk in tool-integrated agents. CaMeL separates trusted
control flow from untrusted data and reports useful task completion, but its
guarantee holds only under its formal assumptions and supported operations.

The consequence Kiln draws is structural: every model-produced or external value
is untrusted at an effect boundary, and unclear authority denies or escalates
rather than proceeding.

- [AgentDojo](https://proceedings.nips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html)
- [InjecAgent](https://aclanthology.org/2024.findings-acl.624/)
- [CaMeL](https://arxiv.org/abs/2503.18813)

## Delegation is not evidence of benefit

Anthropic reports a 90.2% improvement for one internal multi-agent research
evaluation while documenting coordination, cost, and reliability challenges. The
result is provider- and task-specific. It is not evidence that delegation is
generally superior, and Kiln does not treat it as a reason to delegate by
default.

- [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

## Standards cover parts, not the whole

NIST SP 800-207A supports granular identity-based policy decision and
enforcement without implicit trust. OWASP recommends least privilege, per-tool
authorization, input and output validation, monitoring, human review for
consequential actions, secrets lifecycle controls, and non-disclosing public
errors. The 2026 NIST agent-identity initiative covers identification,
authorization, audit, and non-repudiation but remains an emerging concept paper,
not a final standard.

Protocol specifications each bound a different slice: A2A provides task and
context identity and lifecycle concepts without promising complete retained
history; MCP forbids token passthrough and requires audience validation;
OpenTelemetry supplies observability vocabulary while warning that arguments and
results may carry sensitive content.

- [NIST SP 800-207A](https://csrc.nist.gov/pubs/sp/800/207/a/final),
  [NIST agent identity concept paper](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents)
- OWASP:
  [agent security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html),
  [prompt injection](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html),
  [secrets](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html),
  [error handling](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
- [A2A specification](https://a2a-protocol.org/latest/specification/),
  [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization),
  [OpenTelemetry GenAI](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

## Accepted separations

- An **enforcement point** external to the agent validates identity, delegated
  scope, resource, operation, parameters, current policy, and revocation state.
  Enforcement is not a prompt.
- **Delegation only attenuates.** A child never gains authority its parent
  lacked, and effects are re-authorized rather than inherited.
- **Missing, unsupported, unavailable, and contradictory evidence are distinct
  outcomes.** Collapsing them into one is how an unknown becomes a silent pass.
- **Audit reconstruction is not deterministic re-execution.** Ordered,
  integrity-bound, redacted lifecycle evidence supports the first; only a
  replayable contract supports the second.
- **Child output is an untrusted proposal** until validated, and adapter
  limitations are reported rather than smoothed over.

## Non-claims

- Agent-security benchmarks cover constrained environments and age quickly.
- No cited standard establishes complete agent authorization or replay; each
  covers a different portion of the problem.
- These sources support Kiln's threat hypotheses and evidence requirements. They
  do not make the resulting review checklist a guarantee of security.
