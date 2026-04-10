# 16 Kiln Coordination Intelligence — Applied Today

## Research Prompt

```
You are a senior research architect evaluating Kiln's coordination intelligence mechanisms as real biological coordination systems, not just inspired names.

Kiln's coordination intelligence primitives (these are real, implemented code):

1. ThresholdAllocator (threshold-allocator.ts):
   - Response-threshold task allocation, modeled on ant colony division of labor
   - Per-agent per-category thresholds (7 TaskCategory types)
   - allocate(): strict threshold check — only agents whose threshold ≤ stimulus intensity
   - allocateWithFallback(): least-resistant agent if no strict match
   - Adaptive EMA learning via recordOutcome(): adjusts thresholds using AdaptiveConfig
     - alpha (EMA weight), successDelta (threshold decrease on success), failureDelta (threshold increase on failure)
     - floor/ceiling bounds, hysteresisWindow (recent outcomes buffer)
   - resetAdaptation(agentId?) restores initial state

2. CascadeController (cascade-controller.ts):
   - Damped cascade energy model for handoff chain termination
   - Inspired by neural field theory
   - Formula: A(t+1) = decay * A(t) + gain - cost
   - Initial energy from complexity score (0.3–1.0 range)
   - shouldContinue(gain): returns whether cascade chain should continue
   - Hard maxDepth safety net
   - History tracking via CascadeSnapshot

3. TaskChannel (task-channel.ts):
   - Stigmergy coordination substrate (Workforce task channel pattern)
   - Lifecycle: publish() → claim() → complete()/fail()/release()
   - Auto-unblocks dependents on completion
   - Results-only publishing (no tool call logs)
   - Queries: open(), byStatus(), byAssignee(), counts()

4. TeamComposer (team-composer.ts):
   - Domain-driven team templates (4 built-in: java-spring, react-typescript, python, generic)
   - compose(domain, complexity) returns ComposedTeam
   - Pre-configured ThresholdAllocator + CascadeController per team
   - Roles: required vs on-demand (complexity < 0.4 filters on-demand roles)
   - pipelineOrder for sequential chains
   - BUILTIN_TEMPLATES frozen array

5. SwarmStore (mcp/swarm-store.ts):
   - SqliteMemoryStore-backed swarm state
   - join/leave/status/broadcast/claim/release operations
   - Tag conventions: _swarm:, _member:, _claim:

6. Orchestrator strategies:
   - Sequential: agents in order
   - Supervisor: one agent delegates to others
   - Swarm: SwarmStrategy wired to all 5 coordination primitives

For each primitive:
1. What biological mechanism it is trying to model
2. Whether the implementation is structurally faithful enough to be useful
3. Where it is real architecture vs naming veneer
4. What changes would make it more biologically rigorous
5. What telemetry is needed to prove it works

Then provide:
- strongest mechanism in the current design
- weakest mechanism in the current design
- top 3 research directions to strengthen this area

End with these sections:
- Mechanisms
- Software Abstractions
- Direct Kiln Mappings
- Risks / Misuse
- Where The Analogy Breaks
- Actionable Research Follow-Ups
```
