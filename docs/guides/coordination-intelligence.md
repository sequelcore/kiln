# Coordination Intelligence

> For the theoretical foundations behind this design, see [Coordination Intelligence Research](../research/coordination-intelligence.md).

Coordination Intelligence provides biologically-grounded primitives for multi-agent coordination within team sessions. Rather than orchestrating agents through explicit messaging (a "digital conference room"), agents coordinate through shared environmental state -- a "digital organism" pattern.

Five primitives work together:

- **ThresholdAllocator** -- response-threshold task allocation (ant colony model)
- **CascadeController** -- cascade energy model for handoff chain termination (neural field theory)
- **TaskChannel** -- stigmergy coordination substrate
- **TeamComposer** -- domain-driven team template composition
- **Adaptive EMA** -- threshold adaptation via outcome feedback

These primitives are wired into `SwarmStrategy` for swarm-mode team execution.

---

## ThresholdAllocator

Each agent holds a threshold per task category (0-1). When task demand exceeds the agent's threshold, the agent claims the task. Among eligible agents, the one with the **lowest threshold** wins -- this produces emergent specialization without central coordination.

### TaskCategory

Seven task categories map signals from the `ComplexityScorer` to coordination decisions:

```
research | code | review | ops | writing | triage | general
```

Category inference is handled by `inferCategory()` in `demand-signal.ts`, which maps complexity signals:

| Signal | Category |
|--------|----------|
| hasCodeBlocks + hasTools | `code` |
| hasCodeBlocks, no tools | `review` |
| hasReasoningMarkers, no code | `research` |
| hasTools only | `ops` |
| none of the above | `general` |

### allocate() vs allocateWithFallback()

- `allocate(demand)` -- strict allocation. Returns `null` if no agent's threshold is exceeded. Use when you want agents to stay idle until demand is clearly high enough.
- `allocateWithFallback(demand)` -- always returns a result. If no threshold is exceeded, returns the agent with the lowest threshold for that category. Use when every task must be handled.

### Code Example

```ts
import {
  ThresholdAllocator,
  type AgentThresholds,
  type TaskDemand,
  DEFAULT_THRESHOLD,
} from "@kilnai/core";

const agentConfigs: AgentThresholds[] = [
  {
    agentId: "implementer",
    thresholds: {
      code: 0.2,      // very responsive to code tasks
      review: 0.5,
      research: 0.4,
      triage: 0.4,
      ops: 0.6,
      writing: 0.5,
      general: 0.5,
    },
  },
  {
    agentId: "reviewer",
    thresholds: {
      code: 0.5,
      review: 0.2,    // very responsive to review tasks
      research: 0.5,
      triage: 0.4,
      ops: 0.6,
      writing: 0.4,
      general: 0.5,
    },
  },
];

const allocator = new ThresholdAllocator(agentConfigs);

const demand: TaskDemand = { category: "code", demand: 0.65 };
const result = allocator.allocate(demand);
// result.agentId === "implementer" (threshold 0.2 < 0.65)
```

---

## CascadeController

Cascade termination decides when a chain of agent handoffs should stop. Rather than a hard depth counter, the cascade uses a damped energy model inspired by neural field theory:

```
A(t+1) = decay * A(t) + gain - cost
```

- `A(0)` is seeded from task complexity (0.3-1.0 range)
- Each handoff step applies `decay` (energy loss), adds estimated `gain`, subtracts `cost`
- The chain continues only if `A(t+1) >= threshold` AND `step <= maxDepth`

### shouldContinue(gain)

Call `shouldContinue(gain)` before every handoff:

- `gain` is an estimated information gain (0-1). Higher gain (strong reason to hand off) sustains the chain. Low gain (speculative handoff) depletes energy.
- Returns `true` if handoff is allowed, `false` if the cascade should terminate.

### DEFAULT_CASCADE_CONFIG

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `decay` | 0.8 | Energy multiplier per step (lower = faster damping) |
| `threshold` | 0.2 | Minimum energy to allow continuation |
| `maxDepth` | 10 | Hard safety limit on handoff chain length |
| `baseCost` | 0.15 | Fixed cost subtracted per handoff step |

### Code Example

```ts
import { CascadeController, DEFAULT_CASCADE_CONFIG } from "@kilnai/core";

const cascade = new CascadeController(0.7, { maxDepth: 8 });

// Initial energy: 0.3 + 0.7 * 0.7 = 0.79
console.log(cascade.currentEnergy()); // 0.79

// First handoff: gain=0.6
// A(1) = 0.8 * 0.79 + 0.6 - 0.15 = 1.082
const allowed1 = cascade.shouldContinue(0.6);
console.log(allowed1); // true
console.log(cascade.currentEnergy()); // 1.082

// Second handoff: gain=0.1 (low signal)
// A(2) = 0.8 * 1.082 + 0.1 - 0.15 = 0.816
const allowed2 = cascade.shouldContinue(0.1);
console.log(allowed2); // true

// Third handoff: gain=0.1
// A(3) = 0.8 * 0.816 + 0.1 - 0.15 = 0.603
const allowed3 = cascade.shouldContinue(0.1);
console.log(allowed3); // true

// Fourth handoff: gain=0.1
// A(4) = 0.8 * 0.603 + 0.1 - 0.15 = 0.432
const allowed4 = cascade.shouldContinue(0.1);
console.log(allowed4); // true

// Fifth handoff: gain=0.1
// A(5) = 0.8 * 0.432 + 0.1 - 0.15 = 0.296
// 0.296 < threshold 0.2? Actually 0.296 > 0.2, so continues
const allowed5 = cascade.shouldContinue(0.1);
console.log(allowed5); // true (0.296 > 0.2)
```

---

## TaskChannel

TaskChannel implements stigmergy -- agents read and write task state to a shared channel rather than messaging each other directly. This prevents context contamination from tool call logs leaking across agent turns.

### Lifecycle

1. **publish** -- task appears as `open` (or `blocked` if dependencies are unmet)
2. **claim** -- agent marks it as `claimed` (exclusive lock)
3. **complete / fail / release** -- task reaches a terminal state or returns to `open`

Results are concise summaries only. Full tool call logs are never published to the channel.

### Dependency Resolution

When a task completes, `unblockDependents()` automatically transitions blocked tasks whose dependencies are all satisfied to `open` status.

### Query Methods

- `open()` -- all available tasks (status `open`)
- `byStatus(status)` -- all tasks with a specific status
- `byAssignee(agentId)` -- all tasks owned by a specific agent
- `counts()` -- count of tasks by status

### Code Example

```ts
import { TaskChannel } from "@kilnai/core";

const channel = new TaskChannel();

// Publish tasks with dependencies
channel.publish({
  id: "task-1",
  description: "Design system architecture",
  category: "research",
  demand: 0.8,
});

channel.publish({
  id: "task-2",
  description: "Implement core services",
  category: "code",
  demand: 0.7,
  dependencies: ["task-1"],  // must wait for architecture
});

channel.publish({
  id: "task-3",
  description: "Write unit tests",
  category: "review",
  demand: 0.6,
  dependencies: ["task-2"],  // must wait for implementation
});

// task-1 is open, task-2 and task-3 are blocked
console.log(channel.counts());
// { open: 1, claimed: 0, completed: 0, failed: 0, blocked: 2 }

// Claim and complete task-1
channel.claim("task-1", "architect");
channel.complete("task-1", { result: "Architecture doc written at ./docs/arch.md" });

// task-2 is now unblocked automatically
console.log(channel.open().map((t) => t.id)); // ["task-2"]
```

---

## TeamComposer

TeamComposer assembles a pre-configured `ComposedTeam` from a domain template. Each template defines roles with task categories, thresholds, required/optional flags, and pipeline order.

### 4 Built-in Templates

| Template | Domains | Max Concurrent | Max Depth |
|----------|---------|----------------|-----------|
| `java-spring` | java, spring, gradle, maven | 4 | 8 |
| `react-typescript` | react, typescript, vite, next | 3 | 6 |
| `python` | python, django, fastapi, flask | 3 | 8 |
| `generic` | (fallback) | 3 | -- |

### compose(domain, complexity)

- Domain is matched against template domain lists (case-insensitive, exact match)
- `complexity < 0.4` filters to `required` roles only; higher complexity includes optional roles
- Returns a `ComposedTeam` with a configured `ThresholdAllocator` and `CascadeController`

### Code Example

```ts
import { TeamComposer } from "@kilnai/core";

const composer = new TeamComposer();

// Low complexity -- only required roles
const simple = composer.compose("python", 0.3);
console.log(simple.roles.map((r) => r.name)); // ["planner", "implementer", "tester"]

// High complexity -- includes optional roles
const complex = composer.compose("java-spring", 0.7);
console.log(complex.roles.map((r) => r.name)); // ["planner", "implementer", "tdd-guide", "reviewer", "architect"]

// Unknown domain falls back to generic
const generic = composer.compose("unknown-domain", 0.5);
console.log(generic.templateId); // "generic"
```

### registerTemplate()

Add custom templates:

```ts
import { TeamComposer, type TeamTemplate } from "@kilnai/core";

const customTemplate: TeamTemplate = {
  id: "rust-axum",
  name: "Rust Axum Team",
  domains: ["rust", "axum", "tokio"],
  roles: [
    { name: "planner", category: "triage", thresholds: { triage: 0.3 }, required: true, pipelineOrder: 1 },
    { name: "implementer", category: "code", thresholds: { code: 0.2 }, required: true, pipelineOrder: 2 },
  ],
  maxConcurrent: 2,
};

const composer = new TeamComposer([customTemplate]);
```

---

## Adaptive Learning

Threshold adaptation uses an Exponential Moving Average (EMA) over task outcomes. When an agent consistently succeeds at a task category, its threshold for that category decreases (becomes more responsive). When it fails, the threshold increases (becomes less responsive).

### Adaptation Rules

- Adaptation begins only after `hysteresisWindow` outcomes have been recorded for that agent/category pair
- Thresholds are clamped to `[floor, ceiling]` to prevent runaway values
- Delta is scaled by `alpha` to keep adaptation gradual

### AdaptiveConfig Parameters

| Parameter | Default | Effect |
|-----------|---------|--------|
| `alpha` | 0.1 | Smoothing factor -- lower = slower adaptation |
| `successDelta` | -0.05 | Threshold decrement on sustained success |
| `failureDelta` | 0.08 | Threshold increment on sustained failure |
| `floor` | 0.05 | Minimum threshold (agent never becomes hyperactive) |
| `ceiling` | 0.95 | Maximum threshold (agent never fully disengages) |
| `hysteresisWindow` | 3 | Outcomes needed before adaptation starts |

### Code Example

```ts
import { ThresholdAllocator, type TaskOutcome } from "@kilnai/core";

const allocator = new ThresholdAllocator(
  [{ agentId: "implementer", thresholds: { code: 0.5 } }],
  { hysteresisWindow: 3 }
);

// First 3 outcomes: no adaptation (hysteresis not reached)
allocator.recordOutcome({ agentId: "implementer", category: "code", success: true });
allocator.recordOutcome({ agentId: "implementer", category: "code", success: true });
allocator.recordOutcome({ agentId: "implementer", category: "code", success: true });
console.log(allocator.getThresholds("implementer").code); // 0.5 (unchanged)

// 4th outcome: adaptation begins
allocator.recordOutcome({ agentId: "implementer", category: "code", success: true });
console.log(allocator.getThresholds("implementer").code); // ~0.495 (lowered)

// Failures raise threshold
allocator.recordOutcome({ agentId: "implementer", category: "code", success: false });
allocator.recordOutcome({ agentId: "implementer", category: "code", success: false });
allocator.recordOutcome({ agentId: "implementer", category: "code", success: false });
allocator.recordOutcome({ agentId: "implementer", category: "code", success: true }); // hysteresis reached
console.log(allocator.getThresholds("implementer").code); // ~0.567 (raised)

// Reset to initial thresholds
allocator.resetAdaptation("implementer");
console.log(allocator.getThresholds("implementer").code); // 0.5
```

---

## SwarmStrategy Integration

`SwarmStrategy` wires all five primitives together for swarm-mode team execution:

1. **Agent selection** -- `ThresholdAllocator.allocateWithFallback()` replaces naive first-agent selection
2. **Handoff termination** -- `CascadeController.shouldContinue()` replaces the hard depth counter
3. **Task tracking** -- `TaskChannel` publishes/claims/completes tasks throughout the session
4. **Outcome feedback** -- after each task, `allocator.recordOutcome()` feeds success/failure back into the EMA

### Fallback Behavior

When coordination primitives are unavailable (`allocator` or `taskChannel` is `undefined` in `StrategyContext`):

- Agent selection falls back to `agentKeys[0]` (first agent in roster)
- `CascadeController` is instantiated locally with `complexity: 1.0`
- Task channel operations are skipped

### StrategyContext Fields

The `StrategyContext` type exposes coordination state through these fields:

| Field | Type | Description |
|-------|------|-------------|
| `allocator` | `ThresholdAllocator \| undefined` | Task allocation with adaptive thresholds |
| `cascadeController` | `CascadeController \| undefined` | Cascade energy state |
| `taskChannel` | `TaskChannel \| undefined` | Stigmergy coordination substrate |

### SwarmConfig

```ts
interface SwarmConfig {
  /** Override cascade energy configuration */
  cascadeConfig?: Partial<CascadeConfig>;
  /** Enable/disable coordination primitives. Default: true */
  useCoordination: boolean;
}
```

---

## Configuration Reference

### CascadeConfig

```ts
interface CascadeConfig {
  decay: number;      // 0-1, energy multiplier per step. Default: 0.8
  threshold: number;  // minimum energy to continue. Default: 0.2
  maxDepth: number;  // hard limit on chain length. Default: 10
  baseCost: number;   // fixed cost per handoff. Default: 0.15
}
```

Tuning guidance:
- Increase `decay` (toward 1.0) for longer handoff chains
- Decrease `threshold` to allow chains to continue at lower energy
- Decrease `maxDepth` for tighter cost control
- Increase `baseCost` if handoffs are expensive relative to task value

### AdaptiveConfig

```ts
interface AdaptiveConfig {
  alpha: number;           // adaptation smoothing. Default: 0.1
  successDelta: number;    // threshold change on success. Default: -0.05
  failureDelta: number;    // threshold change on failure. Default: 0.08
  floor: number;           // minimum threshold. Default: 0.05
  ceiling: number;         // maximum threshold. Default: 0.95
  hysteresisWindow: number; // outcomes before adaptation. Default: 3
}
```

Tuning guidance:
- Decrease `alpha` for slower, more stable adaptation (fewer oscillations)
- Increase `successDelta` magnitude for faster specialization on success
- Increase `failureDelta` magnitude for faster disengagement on repeated failure
- Increase `hysteresisWindow` to require more evidence before adapting

---

## Related Guides

- [Multi-Agent Routing](multi-agent.md) -- which agent handles an inbound message (tier routing)
- [Multi-Tenant](multi-tenant.md) -- tenant isolation and configuration
- [Team Modes](../concepts.md#team-modes) -- sequential, supervisor, and swarm execution modes
