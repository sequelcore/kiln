# Coordination Intelligence: Theoretical Foundations

## Abstract

This document surveys the biological and computer science foundations underlying Kiln's coordination primitives. It covers ant colony response-threshold models, winner-take-all neural competition, Global Workspace Theory, neural field dynamics, and three multi-agent CS papers (Conductor, Workforce, EvoMAC). Each section maps the source material to a concrete Kiln component: `ThresholdAllocator`, `CascadeController`, `TaskChannel`, and domain-driven team composition.

---

## 1. Biological Models

### 1.1 Ant Colony Response-Threshold Model

#### Mechanism

Ant colonies distribute task work without a central scheduler. Each worker holds a threshold θ_ij per task type j. When the demand stimulus S_j (a persistent environmental signal, or "stigmergic trace") exceeds the worker's threshold, the worker activates with probability:

```
P(S_j, θ_ij) = S_j² / (S_j² + θ_ij²)
```

Workers that repeatedly perform a task reinforce their commitment to it: doing a task lowers the corresponding threshold; not doing it raises the threshold. Specialization emerges from initially homogeneous agents through this reinforcement loop, without any explicit assignment signal.

#### Why It Scales

The mechanism scales because (i) the relevant signal lives in the environment (persistent traces / stigmergic variables), eliminating communication bottlenecks; (ii) each agent applies simple, cheap local rules; and (iii) the colony gains robustness through redundancy — individuals fail, the system continues — and flexibility because emergent patterns shift when stimuli shift. The ant colony optimization literature explicitly names flexibility, robustness, decentralization, and self-organization as consequences of the stigmergic scheme.

#### Failure Modes

- **Premature lock-in:** small initial fluctuations amplify via positive feedback until the collective commits to a suboptimal path. The two-bridge experiment demonstrates how fluctuations plus autocatalysis drive convergence to a single branch.
- **Trace saturation / state staleness:** if the signal persists too long, the colony responds slowly to change. This is the engineering equivalent of stale shared state. The stability of stigmergy depends explicitly on trace persistence and evaporation dynamics.
- **Stimulus ambiguity:** if S_j conflates causes (backlog signal does not distinguish capacity shortage from noise), threshold-based responses misallocate resources. This is the inherent cost of cheap local signals.

#### Minimum Information Per Agent

Each agent needs: (1) a local read of S_j for the relevant task, (2) its own threshold θ_ij, and (3) a way to write a progress signal (reduce S_j or reinforce the trace). It does not need to know the identity of other agents or any global state.

#### Mapping to Kiln: ThresholdAllocator

`ThresholdAllocator` (`core/src/orchestrator/threshold-allocator.ts`) implements this model directly. Each agent holds thresholds per `TaskCategory`. Demand is computed by `inferCategory()` in `demand-signal.ts`. The `allocate()` method applies strict threshold comparison; `allocateWithFallback()` always returns the least-resistant agent. `recordOutcome()` feeds success/failure back through an EMA to implement adaptive threshold reinforcement. See Section 4 for design rationale.

---

### 1.2 Winner-Take-All and Lateral Inhibition

#### Mechanism

In winner-take-all (WTA) networks, multiple units compete for activation. Lateral inhibition suppresses rival activations: each candidate drives its own activation up; the shared inhibitory circuit cuts the others, leaving a single winner. Evidence from auditory cortex models proposes WTA-scale inhibitory interactions linked to GABAergic inhibition, reinforcing the role of global competition for improving selectivity.

#### Scaling Properties

The mechanism scales because the selection rule is local and composable. The network does not compare all-against-all with explicit messages; competition emerges from recurrent connectivity and shared inhibition. Microcircuit models show that the WTA vs. winners-share-all (WSA) regime depends on the balance of lateral inhibition vs. self-inhibition, which means the granularity of selection is tunable.

#### Failure Modes

- **Multiple winners:** when self-inhibition dominates lateral inhibition (WSA regime), the result is duplicated work or split ownership.
- **Wrong winner:** overly strong or poorly structured lateral inhibition can select an agent that did not have the highest input signal.
- **Oscillation / winnerless dynamics:** some cortical models describe winnerless regimes where dominance alternates over time; in multi-agent coordination this manifests as thrashing — repeated reassignments without convergence.

#### Minimum Information Per Agent

Each unit needs: (1) its own salience signal, (2) an aggregate inhibitory signal (or a "claimed" flag), and (3) a local threshold/gain for deciding whether to compete or yield. It does not need to enumerate all competitors; the inhibitory bus is sufficient.

#### Mapping to Kiln: Competitive Agent Bidding

The `TaskChannel` claim operation (`core/src/orchestrator/task-channel.ts`) implements WTA semantics: `claim()` provides an exclusive atomic lock. Without atomic claiming, multiple agents would act simultaneously (multiple winners). The `ThresholdAllocator` selects the lowest-threshold eligible agent, which is the WTA winner under the threshold ordering.

---

### 1.3 Global Workspace Theory

#### Mechanism

Global Workspace Theory (Baars) proposes a "workspace" as a broadcast medium: many specialized modules process in parallel (mostly non-consciously), and a subset of contents wins access to the workspace, becoming globally available to all processors. In the Global Neuronal Workspace formulation (Dehaene, Changeux), a content becomes conscious when a neural population is amplified by top-down attention to a brain-scale coherent state that enables global access by local processors.

#### Scaling Properties

The architecture scales because (i) it separates parallel specialized modules from a single limited integration channel, and (ii) the value of the broadcast is precisely coordination without all-to-all messaging. The GNW model emphasizes long-range connectivity and a functional "space" supporting working memory and top-down control.

#### Failure Modes

- **Workspace overload:** limited capacity causes too many candidate items to compete, degrading throughput (equivalent to a broadcast storm). The GWT architecture is explicitly described as capacity-limited with attentional gating.
- **Access failure (no ignition):** in GNW, "ignition" is a nonlinear all-or-nothing transition associated with sustained recurrent processing. If the signal does not meet the conditions, it remains local and sub-threshold — it is never globally broadcast.

#### Difference from Simple Pub/Sub

A typical pub/sub bus is neutral: anyone publishes, subscribers receive, there is no intrinsic competition for access, no capacity limit, no ignition criterion. In GWT/GNW, the workspace is a scarce resource with selection mechanisms (competition, attention) and nonlinear access dynamics (ignition), not merely message distribution.

#### Mapping to Kiln: TaskChannel as Limited Workspace

`TaskChannel` implements the GWT pattern at the infrastructure level. A central task channel functions as a shared publication/read medium. Workers do not message each other directly. Published content is results-only — full tool call logs are never broadcast — which directly replicates the GWT insight that workspace content must be concise to avoid overload.

---

### 1.4 Neural Field Theory (Wilson-Cowan, Amari)

#### Mechanism

Neural field models describe neural populations as a spatial/functional continuum whose activity evolves through excitatory and inhibitory interactions, governed by firing-rate dynamics and differential equations. In the Amari framework, depending on the connectivity kernel and the level of homogeneous input, the field can exhibit distinct regimes:

- **Extinction:** activity dies out
- **Global excitation:** activity spreads uniformly
- **Bistability:** two stable states (on/off)
- **Localized activity bumps:** a sustained activation at one location

A localized excitation, once evoked, can persist after the stimulus disappears and can shift toward the input maximum.

#### Scaling Properties

The dynamics are defined by connectivity kernels and global parameters (gain, base stimulus) rather than per-agent control. This produces macroscopic phenomena: attractors (stable states), hysteresis, and traveling waves that transport "focus" of activity without explicit coordination between individual units.

#### Failure Modes

- **Runaway propagation:** in supercritical regimes, excitation expands without bound. The Amari framework formalizes explicitly how small parameter changes shift the qualitative regime.
- **Premature extinction:** in subcritical regimes, activation decays before completing useful work.
- **Proximity to criticality:** neural cascade analyses show that propagation can be either excessive (avalanche) or suppressed; the critical point — where activity propagates without saturating — is associated with a branching ratio near 1.0.

#### Relevance to Handoff Chain Termination

A handoff chain is analogous to activity propagation: if each handoff increments or sustains "activation" above the propagation threshold, the chain continues; if activation decays, the chain terminates. The design analog is controlling the effective gain × connectivity of the system to keep it subcritical or near-critical, avoiding both runaway (infinite handoffs) and premature extinction (early chain abandonment).

#### Mapping to Kiln: CascadeController

`CascadeController` (`core/src/orchestrator/cascade-controller.ts`) implements the damped activation model:

```
A(t+1) = decay * A(t) + gain - cost
```

- `A(0)` is seeded from task complexity (0.3–1.0 range)
- Each handoff step applies `decay` (energy loss), adds estimated `gain`, subtracts `baseCost`
- `shouldContinue(gain)` returns `true` only if `A(t+1) >= threshold` AND `step <= maxDepth`

The `maxDepth` hard limit is the safety guardrail for supercritical runaway. The energy threshold handles subcritical extinction. Default parameters: `decay = 0.8`, `threshold = 0.2`, `maxDepth = 10`, `baseCost = 0.15`.

---

## 2. Computer Science Papers

### 2.1 Conductor (Ross et al., ICLR 2026)

**Note on naming:** Two distinct artifacts share the name "Conductor": (i) a Microsoft open-source YAML-based workflow tooling focused on patterns, security boundaries, and dashboards; and (ii) the ICLR 2026 paper "Learning to Orchestrate Agents in Natural Language with the Conductor," where Conductor is an RL-trained model that produces workflows, assigns subtasks, and defines communication topologies. The description in this section refers to (ii), which matches the technical framing of learned task-to-agent assignment.

#### Central Coordination Mechanism

The Conductor is a language model whose output is a complete coordination strategy expressed as a sequence of steps. For each step it specifies: (1) a natural-language subtask, (2) the ID of the assigned worker model, and (3) an access list controlling which prior results are included in that worker's context. Execution is sequential: the system runs the workflow by prompting workers according to the plan.

#### Problem It Solves

A rules-based or classification-based router selects among pre-defined options (choose a model, choose a fixed topology). The paper argues these approaches are limited by the space of pre-specified strategies. The Conductor, by emitting a natural-language workflow, has specification freedom to invent decompositions, roles, and communication patterns beyond templates.

#### Core Algorithm

The operative data structure is the workflow as three parallel lists (model IDs, subtasks, access lists), which are then parsed and executed. Training uses RL with a format condition (parseable output) and a correctness condition (the final workflow output must be correct), optimizing a policy that generates effective workflows.

#### Assumptions That Can Fail in Production

- **Verifiable reward / correctness signals:** training depends on tasks with clear correctness evaluation, which is rarely clean in enterprise settings.
- **Complementary worker pool:** the approach presupposes useful heterogeneity among workers. A homogeneous pool (same model, different instructions) reduces marginal gain.
- **Loop control:** the paper explicitly requires a recursion limit to avoid infinite loops, revealing that even a learned coordinator needs hard guardrails.

The Conductor is not zero-shot in the strong sense: it is trained with RL on a dataset. In production this implies initial training/fine-tuning cost, or mis-alignment risk if deployed on a different task distribution.

#### What Kiln Borrows vs. Skips

Kiln borrows the insight that coordination overhead (number of worker calls, context forwarded) must be budgeted by design. The paper reports the Conductor learns relatively short workflows (~3 steps on average) and compares efficiency against more expensive multi-agent baselines. Kiln skips the RL training requirement; `ThresholdAllocator` and `RulesRouter` achieve assignment through configured thresholds and complexity scoring without a trained model.

---

### 2.2 Workforce (Qin et al.)

#### Central Coordination Mechanism

Workforce separates three explicit roles: (i) a domain-agnostic Planner that decomposes the problem, (ii) a Coordinator that assigns subtasks and manages dependencies, and (iii) specialized Workers with tool-calling. All communication passes through a shared task channel (central hub): the Coordinator publishes tasks/assignments and Workers return final results to the channel. Workers do not message each other directly.

#### Problem It Solves

The explicit motivation is cross-domain transfer. Multi-agent systems are typically rigid and require redesign or full retraining when the domain changes. Workforce claims that separating domain-agnostic planning from specialized execution allows plug-and-play of new workers for new domains without restructuring the core.

#### Core Data Structure

The operative state is the task channel: subtasks with fields for assignee, status (OPEN / RUNNING / DONE), results, and errors. A critical architectural decision is to keep tool call context isolated within each subtask scope and to publish only concise final results to the channel. This prevents context contamination and controls token cost.

#### Key Insight for Kiln

Workforce demonstrates that the Coordinator and Planner have distinct responsibilities. The Planner produces abstract decomposition; the Coordinator maps subtasks to available capabilities, dispatches them, manages dependencies, integrates results, and forwards them to the Planner for synthesis. This is not planning — it is controlled execution and stateful scheduling.

#### Assumptions That Can Fail in Production

- **Coordinator as single point of failure:** if it mis-routes, it chains incorrect subtasks or creates bottlenecks. Eliminating direct agent-to-agent messaging simplifies the system but concentrates responsibility in the hub.
- **Correct subtask granularity:** context isolation only works if subtasks are well-formed. Tasks that are too large force workers to request more context, and the channel becomes a token dump.
- **Worker self-assessment:** the paper describes workers self-reporting failures to the channel, triggering replanning. LLM self-assessment is noisy; production systems need external verification heuristics.

#### What Kiln Borrows

`TaskChannel` (`core/src/orchestrator/task-channel.ts`) directly implements the Workforce task channel pattern: `publish()` → `claim()` → `complete()` / `fail()` / `release()` lifecycle, results-only publishing (no tool call logs), and automatic unblocking of dependents via `unblockDependents()` on task completion.

---

### 2.3 EvoMAC

#### Central Coordination Mechanism

EvoMAC models the agent team as a directed acyclic graph (DAG): nodes are agents with prompts (subtasks), edges are dependencies. Executing the workflow is a feed-forward pass through the graph (each agent receives the initial requirement plus prior outputs). Rather than fixing the workflow, EvoMAC introduces a self-evolution loop at test time, supported by:

1. A **target proxy** (e.g., unit tests generated by a testing sub-team)
2. An **environment executor** (compiler/runner) that produces objective text-based feedback
3. A **textual backpropagation** algorithm that analyzes which agent contributed to the failure and updates prompts / topology

#### Problem It Solves

EvoMAC targets two limitations of static workflows: (1) performance is bounded by human initialization; (2) the workflow does not adapt to task variability. It seeks adaptation through execution feedback, deliberately avoiding LLM self-critique (which the paper contrasts with its objective feedback loop to avoid bias and hallucination).

#### Core Algorithm

The core is iterative optimization with two explicit assumptions: (i) generating the proxy (unit tests) is easier than solving the full task; (ii) the output can be verified objectively against that proxy in a deterministic environment. With this feedback, a "gradient agent" produces "textual gradients" describing per-agent impact and errors, and an "updating agent" modifies the DAG and prompt assignments.

#### Assumptions That Can Fail in Production

- **Verifiable and objective proxy:** in non-executable domains (open-ended research, creative synthesis), no compiler equivalent exists. EvoMAC depends on verification being both objective and informative.
- **Proxy is "easier than the task":** if generating correct tests is as hard as the code — or if tests are biased — the evolutionary loop can converge toward satisfying defective tests.
- **Iteration cost:** improvement requires more evolution cycles and more LLM calls, which is only worthwhile if quality gains justify the budget.

#### What Kiln Borrows

The EvoMAC insight on domain-driven team composition: composition is not just selecting agents but also modifying roles and dependency topology per task, guided by execution feedback. In practice this means reconfiguring the workflow when you detect (via execution) which sub-capabilities are missing or where errors originate. Kiln implements a lighter version: `TeamComposer` selects a static YAML template at session start based on domain detection. Full DAG mutation (EvoMAC-style) is deferred to future phases, as it requires objective verification infrastructure to be safe in production.

---

## 3. Synthesis

### Biology → CS Paper → Kiln Primitive

| Biological Model | CS Paper | Kiln Primitive |
|-----------------|----------|----------------|
| Ant colony response-threshold (stigmergy) | Workforce (task channel, no direct messaging) | `TaskChannel` + `ThresholdAllocator` |
| WTA / lateral inhibition (winner selection) | Conductor (access list gating, recursion limit) | `TaskChannel.claim()` (atomic WTA) |
| Global Workspace Theory (limited broadcast, competition for access) | Workforce (Coordinator hub, results-only) | `TaskChannel` (results-only, no tool log broadcast) |
| Neural field theory (damped activation, subcritical/supercritical regimes) | Conductor (recursion limit), Workforce (replanning) | `CascadeController` |
| Threshold reinforcement (adaptive specialization via outcome) | EvoMAC (textual backprop, prompt adaptation) | `ThresholdAllocator.recordOutcome()` + EMA |
| Domain-driven team composition | EvoMAC (DAG + topology), Workforce (plug-and-play workers) | `TeamComposer` |

### The Central Thesis: Stigmergy-First Coordination

The three biological models converge on a single architectural principle: **coordination via shared environmental state is more scalable and robust than direct inter-agent messaging.** Ants coordinate through pheromone traces; neural fields coordinate through local field potentials; GWT modules coordinate through the workspace broadcast, not by calling each other.

The three CS papers partially rediscover this principle without explicitly grounding it in biology:
- Workforce's task channel eliminates direct agent-to-agent messaging in favor of shared state — the closest implementation of stigmergy in multi-agent CS.
- Conductor's access lists control what each worker sees from shared results — a form of workspace gating.
- EvoMAC's DAG feed-forward is not stigmergic, but its evolution loop introduces outcome-driven parameter updates that parallel adaptive threshold reinforcement.

Kiln's design choice is to make stigmergy the default coordination substrate. `TaskChannel` is the primary coordination surface. `ThresholdAllocator` determines who acts on what. `CascadeController` determines when the chain ends. Direct handoff messaging (`SwarmStrategy` JSON handoffs) is reserved for cases where semantic context must accompany the transfer — analogous to a biological organism using both pheromone traces (stigmergy) and direct neural signals (handoff) depending on urgency.

### Gaps in the CS Literature

Three biological mechanisms lack adequate implementation in any of the three papers, and remain relevant design concerns for production orchestrators:

1. **Stigmergic trace dynamics (evaporation, saturation):** the papers use shared state or central control but do not model trace persistence and evaporation as a stability variable. Without evaporation, lock-in (premature convergence) risk is high.

2. **Controlled WTA granularity (K-winner selection):** the papers default to "select one" (Coordinator) or "select a workflow" (Conductor), with no robust mechanism for allowing K winners when tasks are genuinely parallelizable and collapsing to K=1 when there is conflict. Biological WTA vs. WSA control through inhibition balance suggests that fixed-K is suboptimal.

3. **Dynamic cascade termination criterion:** Conductor uses a recursion limit; Workforce uses replanning; EvoMAC uses a fixed iteration count. None formalizes a criterion based on effective branching ratio or damped activation for terminating coordination chains — despite this being a central concern in neural field theory and criticality analysis. `CascadeController` is Kiln's answer to this gap.

---

## 4. References

### Biological Models

- Bonabeau, E., Dorigo, M., & Theraulaz, G. (1999). *Swarm Intelligence: From Natural to Artificial Systems*. Oxford University Press.
- Theraulaz, G., Bonabeau, E., & Deneubourg, J.-L. (1998). Response threshold reinforcements and division of labour in insect societies. *Proceedings of the Royal Society B: Biological Sciences*, 265(1393), 327–332.
- Amari, S.-I. (1977). Dynamics of pattern formation in lateral-inhibition type neural fields. *Biological Cybernetics*, 27(2), 77–87.
- Wilson, H. R., & Cowan, J. D. (1972). Excitatory and inhibitory interactions in localized populations of model neurons. *Biophysical Journal*, 12(1), 1–24.
- Baars, B. J. (1988). *A Cognitive Theory of Consciousness*. Cambridge University Press.
- Dehaene, S., & Changeux, J.-P. (2011). Experimental and theoretical approaches to conscious processing. *Neuron*, 70(2), 200–227.
- Mainen, Z. F., & Sejnowski, T. J. (1996). Influence of dendritic structure on firing pattern in model neocortical neurons. *Nature*, 382(6589), 363–366.

### Multi-Agent CS Papers

- Ross, A., et al. (2026). Learning to Orchestrate Agents in Natural Language with the Conductor. *ICLR 2026*.
- Qin, Y., et al. Workforce: Scalable Multi-Agent Collaboration with a Hierarchical Task Channel. *(arXiv preprint)*.
- EvoMAC. Evolutionary Multi-Agent Collaboration for Code Generation. *(arXiv preprint)*.

### Related Kiln Source Files

- `core/src/orchestrator/threshold-allocator.ts` — `ThresholdAllocator` implementation
- `core/src/orchestrator/cascade-controller.ts` — `CascadeController` implementation
- `core/src/orchestrator/task-channel.ts` — `TaskChannel` implementation
- `core/src/orchestrator/demand-signal.ts` — `inferCategory()`, `buildTaskDemand()`
- `core/src/agents/complexity-scorer.ts` — complexity signal computation
- `packages/core/src/agents/rules-router.ts` — Tier 1 rules-based model routing
