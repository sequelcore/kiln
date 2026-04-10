# Control Model

## Canonical Framework

Kiln is modeled as a cybernetic control system.

The system senses state, compares observed state against configured bounds, and
applies bounded corrections through actuators. The goal is stable,
high-quality, policy-compliant autonomous execution under cost, safety,
context, and coordination constraints.

## Sensors

Primary sensors include:

- event emission from the EventBus
- token and cost tracking
- safety detections
- provider and tool execution outcomes
- session and mode state
- coordination and allocation outcomes
- audit and telemetry streams

## Internal State

Important internal state includes:

- session state
- context budget state
- memory state by layer and scope
- safety state and escalation state
- operational mode state
- adaptation and specialization state
- allostatic load and other stability signals

## Controllers

Primary controllers include:

- `IngressGovernor`
- `ContextGovernor`
- safety pipeline
- orchestration and delegation control
- `DemandAllocator`
- `ChainGovernor`
- `ModeGovernor`

These controllers should remain explicit. Control behavior must not be hidden
inside formatting utilities, helper layers, or unnamed wrappers.

## Actuators

Primary actuators include:

- provider adapters
- tool execution engine
- channel senders
- mode transitions
- escalation paths
- memory writes and deletes

## Feedback Loops

Kiln requires explicit feedback loops for:

- safety
- budget
- adaptation
- mode control
- provider or execution circuit breaking

No actuator should act without an observable effect path.

## Regulation Horizons

Control operates across different horizons:

- per-turn
- per-session
- per-day
- longer-lived adaptation horizons

The chosen controller and correction should match the horizon of the signal.

## Predictive Regulation

The control model must support both reactive and anticipatory regulation.

Reactive regulation:

- detect deviation
- apply correction
- verify recovery

Predictive regulation:

- reserve budget before expensive work
- compress context before overflow
- downgrade or restrict capability before a threshold breach
- raise supervision before instability becomes failure

This is the practical allostatic extension of the control model.

## Stability Risks

Primary risks include:

- oscillation
- mode thrashing
- safety escalation cascades
- context bloat
- budget boundary thrashing
- coordination deadlock

## Anti-Drift Rules

- bounded adaptive parameters
- hysteresis on mode changes and threshold reversals
- anti-windup behavior
- explicit reset capability
- explicit audit trail for major corrections
