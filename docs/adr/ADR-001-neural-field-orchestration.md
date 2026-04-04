# ADR-001: Neural Field Orchestration — FieldStore as Coordination Primitive

**Status:** Deferred — implement after all current phases are complete  
**Date:** 2026-04-01  
**Author:** Ricardo Armenta  
**Scope:** `core/src/field/` (new bounded context), `orchestrator/`, `agents/rules-router.ts`, `memory/`

---

## Context

### The Problem with Discrete Orchestration

Every major agent orchestration framework today (LangGraph, AutoGen, CrewAI, Kiln pre-field) treats coordination as a discrete routing graph: agents are named nodes, tasks are tree nodes, routing is rule-based or embedding nearest-neighbor, and memory is key-value storage. This works well for structured workflows but has fundamental limits:

- Routing decisions are stateless per-turn — no accumulated signal from prior activity shapes who gets called next
- Task traversal is explicit (deepen/branch/prune) — no continuous pressure guiding exploration
- Agents don't influence each other except through explicit tool calls or handoffs
- Memory decays but doesn't *propagate* — a strong signal in one area of the knowledge space doesn't attract agents toward it

### The Research Convergence (April 2026)

Multiple independent research traditions are converging on the same insight: **coordination can be modeled as continuous dynamics over a shared medium**, not just discrete message passing between nodes.

Key traditions and their relevance:

| Tradition | Core Idea | Kiln Relevance |
|-----------|-----------|----------------|
| Neural Field Theory (Amari 1977) | Population activity as continuous field with excitatory/inhibitory kernels; stable "bump" attractors emerge from lateral inhibition | Formal basis for inhibition between agents and task attractors |
| Artificial Potential Fields (Khatib 1986) | Planning as gradient descent on a constructed potential (attractors + repulsors) | Task-tree traversal as navigation on an energy landscape |
| Mean-Field MARL (Yang et al., ICML 2018) | Scale multi-agent RL by approximating neighbor interactions via aggregate statistics | EventBus + memory as "mean field" — continuous summary of collective state |
| Active Inference collectives (Heins et al., PNAS 2024) | Collective behavior (flocking, coordination) emerges from agents minimizing surprise — no explicit social rules programmed | Self-organization without hardcoded routing rules |
| Stigmergy / Pheromones (Salman et al., NMI 2024) | Indirect coordination via persistent environmental traces with evaporation | Most directly applicable to Kiln: memory decay ≈ evaporation, EventBus ≈ medium |
| ACO-based LLM routing (AMRO-S 2026, SwarmSys 2025) | Ant Colony Optimization applied to LLM agent routing — pheromone trails over agent/task space, updated asynchronously | Near plug-and-play pattern over Kiln's existing routing and task tree |
| Hopfield Networks ↔ Attention (Ramsauer et al., ICLR) | Modern Hopfield networks (continuous states) are equivalent to transformer attention; memory as energy minimization toward attractors | Memory recall as attractor convergence, not key-value lookup |

### Why Kiln Is a Viable Precursor

Kiln already has the substrate that field-based orchestration requires:

- **EventBus** (43 typed events, ring buffer) — shared medium for signal injection
- **Memory with decay + compaction** — evaporation operator already present
- **Task tree with scoring** (deepen/branch/prune) — discretized potential landscape
- **Swarm primitives** (join/leave/claim/broadcast/release) — coordination primitives for field entry/exit
- **Pluggable orchestration strategies** (sequential/supervisor/swarm) — `field` can be added as a new strategy without breaking existing ones
- **Complexity scorer** (5 signals, stateless) — signal extraction already exists

What Kiln lacks (and what this ADR proposes to add):

- Explicit propagation (diffusion) between memory regions / task nodes
- Continuous shared state snapshot derived from EventBus activity
- Soft routing modulated by field state (distribution over agents, not single selection)
- Inhibitory dynamics (prevent monopolization, enforce exploration)
- Stability monitors (prevent runaway feedback amplification)

---

## Decision

Introduce **`FieldStore`** as a new bounded context (`core/src/field/`) that sits as a derived, continuous state layer over EventBus + memory. It modulates routing and task traversal without replacing the existing discrete primitives.

This is a **coordination overlay**, not a replacement of the engine foundation.

---

## Architecture

### New Bounded Context: `core/src/field/`

```
core/src/field/
  domain/
    field.ts              # Field, FieldRegion, FieldVector, FieldSnapshot interfaces
    field-store.ts        # FieldStore interface (read/write/snapshot/subscribe)
    field-kernel.ts       # KernelFn interface (excitatory, inhibitory, neutral)
    field-config.ts       # FieldConfig: decay rate, propagation radius, inhibition threshold
  infrastructure/
    sqlite-field-store.ts # SQLite-backed FieldStore (WAL, indexed by region + timestamp)
    in-memory-field-store.ts # Dev/test implementation
  field-updater.ts        # EventBus subscriber → field updates (signal injection)
  field-propagator.ts     # Scheduled propagation pass (decay + diffusion over graph/embedding)
  field-inhibitor.ts      # Lateral inhibition: suppress over-saturated regions
  stability-monitor.ts    # Detects oscillation, runaway feedback, divergence
```

### Field Primitive Interfaces

```typescript
// A point in the field — scalar or vector value at a location
interface FieldVector {
  regionId: string         // embedding cluster, task node ID, agent role, or topic hash
  value: number            // scalar field strength (0.0 – 1.0, normalized)
  confidence: number       // signal reliability
  updatedAt: number        // epoch ms
  source: "event" | "propagation" | "inhibition" | "decay"
}

// Snapshot of the full field at an instant
interface FieldSnapshot {
  timestamp: number
  regions: Map<string, FieldVector>
  entropy: number          // global field disorder — high = chaotic, low = converged
  dominantRegions: string[] // top-k by field strength
}

interface FieldStore {
  inject(signal: FieldSignal): Promise<void>
  snapshot(): Promise<FieldSnapshot>
  queryRegion(regionId: string): Promise<FieldVector | null>
  subscribe(cb: (snapshot: FieldSnapshot) => void): () => void
}
```

### How It Integrates with Existing Architecture

#### 1. EventBus → FieldStore (signal injection)

`FieldUpdater` subscribes to EventBus events and injects signals into FieldStore:

```
agent:completed   → +signal in agent's capability region
task:scored       → +signal in task's embedding region  
memory:recalled   → +signal in recalled memory's topic region
tool:executed     → +signal in tool's domain region
session:escalated → inhibitory signal (reduce AI agent field strength)
```

This is non-breaking — EventBus is unchanged, FieldUpdater is a new subscriber.

#### 2. FieldPropagator (scheduled tick)

Every N seconds (configurable), a propagation pass runs:
- Decay: all field values × (1 - decayRate)
- Diffusion: neighboring regions (by embedding similarity or task graph adjacency) receive a fraction of their neighbors' values via kernel
- Inhibition: regions above saturation threshold suppress their neighbors (lateral inhibition)

This is the Amari-inspired operation. In stigmergy terms: evaporation + diffusion.

#### 3. Soft Routing via FieldSnapshot

`RulesRouter` gains an optional `fieldStore` dependency. When present:

```
Before (hard routing):   agent = rules.match(intent) ?? embeddings.nearest(intent)
After  (field-modulated): candidates = rules.match(intent) + embeddings.topK(intent, k=5)
                          weights = candidates.map(c => fieldSnapshot.queryRegion(c.role))
                          agent = softmax(weights, temperature=T).sample()
```

- High field strength in a region = recently successful, amplified
- Inhibited region = recently saturated, suppressed
- Temperature controls exploration/exploitation tradeoff

#### 4. Task Tree Traversal as Energy Navigation

`deepen/branch/prune` decisions in the task tree gain field-weighted scoring:

- `deepen`: follow path where field strength is high (pheromone trail)
- `branch`: explore region where field strength is low but entropy is high (unexplored)
- `prune`: suppress paths where field has decayed below threshold

#### 5. StabilityMonitor

Subscribes to FieldSnapshot stream. Emits `field:unstable` event if:
- Entropy oscillates (divergence)
- A single region dominates >80% of field strength for >N ticks (monopolization)
- Field strength collapses to near-zero across all regions (starvation)

Gateway safety middleware can respond to `field:unstable` by throttling or falling back to deterministic routing.

---

## Implementation Phases (when resumed)

### Phase F1 — FieldStore substrate
- Define all interfaces in `core/src/field/domain/`
- Implement `InMemoryFieldStore` for dev/test
- Implement `SqliteFieldStore` for production
- Wire `FieldUpdater` to EventBus (read-only tap, no EventBus changes)
- Zero behavior change — field is populated but not consumed

### Phase F2 — Propagation + decay
- Implement `FieldPropagator` (scheduled tick, configurable interval)
- Implement decay operator
- Implement diffusion over task graph (graph adjacency first, embedding adjacency second)
- Add `StabilityMonitor` with `field:unstable` event

### Phase F3 — Soft routing integration
- Extend `RulesRouter` with optional `fieldStore` dependency
- Implement softmax-weighted agent selection
- Implement temperature + inhibition threshold config in `FieldConfig`
- Add field-weighted task traversal to task tree scorer

### Phase F4 — Inhibition + advanced kernels
- Implement lateral inhibition (Amari-style kernel)
- Add excitatory/inhibitory kernel configuration per agent role/capability
- Validate stability under load (integration tests with simulated EventBus streams)

### Phase F5 — Observability + tuning
- Expose `FieldSnapshot` in `/dev/field` dev route (Studio visualization)
- Add Prometheus metrics: field entropy, dominant regions, propagation latency
- Add OTel spans for field-modulated routing decisions

---

## Dependency Rules

- `core/src/field/` has zero dependencies on `runtime/` — pure engine primitive
- `FieldStore` interface lives in `core/src/engine/domain/` (alongside Memory, Task, Channel)
- `SqliteFieldStore` lives in `core/src/field/infrastructure/` (same pattern as `sqlite-store.ts`)
- `RulesRouter` depends on `FieldStore` interface only — no infrastructure import
- `FieldUpdater` depends on `EventBus` interface only

---

## What This Is Not

- **Not a model.** No training, no weights, no neural network is built. This is pure coordination logic.
- **Not a replacement for existing routing.** Rules router and embedding router remain. Field is a modulation layer.
- **Not a breaking change.** All existing apps work without `FieldConfig` — field is opt-in via gateway.yaml.
- **Not a research prototype.** By the time this is implemented, the stigmergy/mean-field patterns will be validated in production systems (AMRO-S, SwarmSys). This is an engineering task, not a research task.

---

## References

| Paper | Why Relevant |
|-------|-------------|
| Amari, S. (1977). Dynamics of pattern formation in lateral-inhibition type neural fields | Formal basis for field with excitatory/inhibitory kernels and stable attractors |
| Khatib, O. (1986). Real-time obstacle avoidance for manipulators and mobile robots | Potential fields for navigation — task traversal as gradient descent |
| Yang, Y. et al. (ICML 2018). Mean Field Multi-Agent Reinforcement Learning | Scaling coordination via aggregate statistics — EventBus as mean field |
| Ganapathi Subramanian, S. et al. (AAMAS 2020). Multi-Type Mean Field RL | Heterogeneous agent types in mean-field — maps to Kiln's roles/capabilities |
| Heins, C. et al. (PNAS 2024). Collective behavior from surprise minimization | Self-organization from active inference without explicit routing rules |
| Friston, K. (2023). The free energy principle made simpler | Conceptual basis for energy landscapes and Markov blankets in collectives |
| Ramsauer, H. et al. (ICLR). Hopfield Networks is All You Need | Memory as attractor convergence — recall as energy minimization |
| Ambrogioni, L. (2024). Diffusion models are associative memory | Diffusion as energy/field dynamics — score-guided navigation |
| Mordvintsev, A. et al. (2020). Growing Neural Cellular Automata | Local update rules → emergent self-organization — blueprint for propagation |
| Salman, et al. (NMI 2024). Automatic design of stigmergy-based behaviours | Direct engineering precedent: pheromone fields for swarm coordination |
| AMRO-S (2026). Multi-Agent LLM Routing via Ant Colony Optimization | Near plug-and-play ACO routing with pheromone update/evaporation for LLM agents |
| SwarmSys (2025). Swarm intelligence for dynamic LLM agent assignment | Closed-loop pheromone reinforcement for agent assignment and convergence |
| Google Research + DeepMind (2025). Towards a Science of Scaling Agent Systems | Empirical trade-offs: topology, coordination overhead, error amplification — critical for stability design |

---

## Prerequisites (before implementation begins)

- [ ] All current phases complete (Phase 4.5, Phase 5 LocalSession, Phase 7 TUI)
- [ ] LocalSession / TurboQuant unblocked (llama.cpp issue #20977 resolved) — optional but enables field-aware local inference
- [ ] At least one production workload on Kiln with sufficient EventBus volume to validate field dynamics (signal starvation is a real risk on low-traffic deployments)

---

## Success Criteria

- FieldStore populates from real EventBus activity with no observable latency impact (<2ms per inject call)
- Soft routing produces measurably different agent selection distribution vs. deterministic routing under repeated similar tasks
- StabilityMonitor correctly detects monopolization and starvation in integration tests
- All existing tests pass — zero regression from field layer introduction
- Field-modulated routing is opt-in and disabled by default — no behavior change for existing apps

---

*This ADR captures the architectural intent. Implementation details will be refined during Phase F1 planning when the time comes. The core insight — treat the medium between agents as a first-class primitive with continuous dynamics — should be preserved regardless of implementation changes.*
