# Research

This directory contains the canonical research basis for Kiln.

Research explains why the architecture takes its current shape. It does not
define the active architecture contract. For doctrine, use
[`../architecture/README.md`](../architecture/README.md).

## Canonical Set

- `01-kiln-research-synthesis.md`
  Final research conclusion and the mechanism families that survived
  consolidation.

- `02-cybernetic-foundations.md`
  Control-theory rationale for treating Kiln as a control plane rather than an
  orchestration-first product.

- `03-biological-mechanisms.md`
  Biological and neural mechanism taxonomy, with explicit limits and
  mechanism-to-software value.

- `04-current-state-mapping.md`
  Mapping from the research model to Kiln's current implementation and the
  gaps that still matter. This document is a snapshot, so it must be updated
  when implementation slices promote research ideas into canonical
  architecture.

## Topical Research

- `05-memory-systems.md`
  Layered memory, recall, consolidation, reconsolidation, and forgetting
  policy as research inputs to the memory architecture.

- `06-safety-defense.md`
  Immune-system research applied to layered defense, danger signals, and
  threat memory.

- `07-regulation-and-adaptation.md`
  Homeostasis, allostasis, load, and predictive regulation as the basis for
  operating modes and adaptation.

- `08-context-governance.md`
  Selective attention, inhibition, active shared medium, and context membranes
  as research inputs to context selection and budget control.

- `09-tool-execution-and-trust.md`
  Gating, approvals, trust boundaries, interrupts, and observability for real
  tool execution.

- `11-agent-tooling-surface.md`
  External agent-tooling patterns and user pain points that inform Kiln's next
  shared developer tools: patch, tree/stat, image/OCR, output modes, and web.

- `12-agent-tooling-next-surface.md`
  Second-pass research on structured outputs, deferred tool discovery, semantic
  code intelligence, bulk context ingestion, monitors, task state, elicitation,
  and MCP resources.

- `13-work-governance-and-verification.md`
  External and research basis for moving from prompt engineering to governed
  work lifecycles: orchestration preference, structured delegation, verifier
  feedback, and evidence closeout.

- `14-live-browser-operator-surface.md`
  External browser-agent and remote-browser surface research for the late
  browser operator sequence,
  including browser operation, human takeover, replay, stream authority, the
  2026-05-13 reassessment that separates snapshot monitor from real embedded
  browser, local CDP screencast as frame-stream fallback, lock/brokered input,
  sanitized operator evidence, and the native/browser sequence completed
  through `02` native surface foundation, `03` embedded browser host
  capability, and `04` embedded browser operator surface, with `05` native
  cockpit projection performance still deferred.

- `15-background-parallel-agent-surface.md`
  External and local-repository research on foreground subagents, background
  children, parallel worktree/session isolation, timeout recovery, and the
  future Kiln nonblocking managed-agent lifecycle.

- `16-external-engagement.md`
  Official X platform, MCP/community demand, mixed-initiative UX, and
  social-listening limitation research for governed external engagement.

- `17-inspectable-agent-work.md`
  External tracing, hooks, observability, review, and human-AI interaction
  research supporting Kiln's cross-surface inspectable agent work contract.

- `18-execution-surfaces-strategy.md`
  Accepted research basis from external docs, cloned-repo comparison, community
  signal, and local architecture diagnosis supporting Kiln Operator Workspace,
  Kiln Gateway as app AI runtime, and contract-first execution-surface
  convergence.

- `19-clear-writing-skill.md`
  Plain-language, content-design, and developer-documentation research basis
  for promoting a neutral `clear-writing` skill into Kiln core while keeping
  brand, regional, legal, and organization voice outside native product
  doctrine.

- `20-cross-domain-task-taxonomy.md`
  Harness, lab, spec, paper, and local architecture research supporting a
  separate cross-domain work classification model instead of expanding
  model-route suitability into a giant task enum.

- `21-managed-invocation-routing-2026.md`
  Runtime ownership, cloned-harness comparison, current provider/model evidence,
  benchmark limits, and community failure signals for managed child routing.
  Claude Code catalog evidence is obtained through the Agent SDK control-plane
  `Query.supportedModels()` call without iterating the model response stream.

- `22-canonical-mcp-integration-2026.md`
  Stable MCP protocol, official SDK, cloned Codex/Claude Code/OpenCode,
  Roblox Studio, security research, repository gaps, and accepted design
  decisions for Kiln-owned MCP resolution, execution, and native projection.

- `23-prompt-component-governance.md`
  Official guidance and cloned-harness evidence for minimal prompt components,
  progressive disclosure, model-specific prompt evaluation, neutral response
  skills, and optional validated controlled-technical-English packs.

- `24-backend-skill-scout-2026.md`
  Official platform evidence and external skill comparison supporting the
  consolidated Sequel backend router, Spring, PostgreSQL, API, security, and
  testing capability catalog.

- `25-hybrid-model-team-2026.md`
  Current Claude Code, Codex OAuth, and OpenCode Go catalog research, model and
  mode evidence, benchmark limitations, candidate team topology, and explicit
  route-promotion gates.

- `26-opencode-go-roster-2026.md`
  Live 17-model OpenCode Go catalog audit, commercial and data-policy boundary,
  current config diagnosis, lean specialist roster, and profile-v3 evaluation
  queue.

- `27-write-and-render-route-admission-2026.md`
  Disposable write leases, strict tool/sandbox authority, hidden backend tests,
  pinned browser/accessibility verification, live repeated results, and the
  final write-route admission decision.

- `28-claude-model-route-validation-2026.md`
  Exact live validation and bounded team roles for Claude Opus, Sonnet, and
  Haiku, plus the explicit reason Fable remains outside the admitted set.

- `web-retrieval-provider-routing.md`
  Accepted provider-neutral search routing decision based on current provider
  docs, decision-surface research, strict postconditions, and reproducible
  retrieval metrics.

## Supporting Reference

- `10-coordination-intelligence.md`
  Adopted research synthesis for deterministic topology selection, bounded
  managed execution, independent review, and the explicit non-adoption of
  disconnected threshold, chain-energy, and parallel-registry prototypes.

## Reading Order

1. `01-kiln-research-synthesis.md`
2. `02-cybernetic-foundations.md`
3. `03-biological-mechanisms.md`
4. `04-current-state-mapping.md`
5. `05-memory-systems.md`
6. `06-safety-defense.md`
7. `07-regulation-and-adaptation.md`
8. `08-context-governance.md`
9. `09-tool-execution-and-trust.md`
10. `10-coordination-intelligence.md`
11. `11-agent-tooling-surface.md`
12. `12-agent-tooling-next-surface.md`
13. `13-work-governance-and-verification.md`
14. `14-live-browser-operator-surface.md`
15. `15-background-parallel-agent-surface.md`
16. `16-external-engagement.md`
17. `17-inspectable-agent-work.md`
18. `18-execution-surfaces-strategy.md`
19. `19-clear-writing-skill.md`
20. `20-cross-domain-task-taxonomy.md`
21. `21-managed-invocation-routing-2026.md`
22. `22-canonical-mcp-integration-2026.md`
23. `23-prompt-component-governance.md`
24. `24-backend-skill-scout-2026.md`
25. `25-hybrid-model-team-2026.md`
26. `26-opencode-go-roster-2026.md`
27. `27-write-and-render-route-admission-2026.md`
28. `28-claude-model-route-validation-2026.md`
29. `web-retrieval-provider-routing.md`
