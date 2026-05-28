# Managed Agent Replay And Timeout Evidence Plan

Date: 2026-05-28

## Objective

Close the remaining managed-agent live-session gaps without compatibility
shims:

- persist canonical managed invocation lifecycle events into GUI/TUI
  transcripts through the existing runtime session-event sink
- allocate transcript sequences in the session store instead of each surface
  owning a local counter
- expose terminal child lineage and timeout budget evidence in model-facing
  managed-agent output, metadata, cockpit replay, and CLI/TUI/GUI projections
- make timeout tests deterministic and grounded in runtime-owned deadlines
- document the primary timeout and long-running-task guidance behind the
  route-owned timeout decision

## Non-Goals

- No request-local timeout override.
- No CLI-local budget admission shim.
- No resource-read pagination ownership shim outside the resource plane.
- No GUI synthetic replay backfill when canonical lifecycle events can be
  persisted.
- No provider-native compatibility contract.

## Completed Slices

1. Runtime projection
   - `managed_agent.start`, `status`, `list`, `join`, and terminal result output
     expose `timeoutMs`, `timeoutSource`, `childSessionId`, and `childTurnId`
     when present.

2. Transcript persistence
   - `TranscriptStore` owns append-time sequence allocation and serializes
     concurrent appends per session.
   - GUI/TUI session writers persist canonical `agent_invocation_*` events via
     `ManagedInvocationSessionEventSink`.
   - GUI join/cancel terminal events publish through the same sink after they
     are recorded on the runtime session.

3. Gateway projection
   - The cockpit read-only projection carries child lineage and timeout
     provenance from canonical events and normalized managed-tool evidence.
   - GUI, TUI, and native managed-agent cockpit views render that lineage and
     timeout provenance from the shared view-state model.

4. Timeout verification
   - CLI-harness timeout tests use fake timers and assert timeout diagnostics,
     child lineage, and cleanup instead of depending on wall-clock races.

5. Sink fanout hardening
   - Managed invocation session-event sink composition fans out through all
     registered sinks, so a failed live relay does not block transcript
     persistence.
   - GUI join/cancel controls publish existing terminal events on duplicate
     controls, preserving replay evidence without creating new lifecycle
     events.

6. Documentation
   - Stable managed-agent architecture, timeout research, and roadmap summary
     document the completed behavior and the deliberate external dependencies.

## Verification

- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern "nonblocking managed child lifecycle tools|managed child times out"`
- `bun test packages/cli/tests/wrapper/session-store-clear.test.ts --test-name-pattern "allocates transcript sequences"`
- `bun run --cwd packages/cli test tests/commands/tui-session-persistence.test.ts --testNamePattern "managed invocation events"`
- `bun run --cwd packages/runtime test tests/managed-agent/opencode-cli-harness-adapter.test.ts --testNamePattern "fake time reaches"`
- `bun run --cwd packages/gateway-contracts test tests/operator-cockpit-projection.test.ts --testNamePattern "managed tool evidence snapshots"`
- `bun run --cwd packages/runtime test tests/gateway/gui-gateway.test.ts --testNamePattern "cancels a live managed-agent invocation"`
- `bun run --cwd packages/gateway-contracts test tests/operator-cockpit-view-state.test.ts --testNamePattern "timed-out"`
- `bun run --cwd packages/gui test tests/managed-agent-cockpit-panel.test.tsx --testNamePattern "timed-out"`
- `bun run --cwd packages/native test tests/managed-agent-cockpit-panel.test.tsx --testNamePattern "timed-out"`

## Remaining External Dependencies

- Runtime/session budget admission remains owned by the runtime budget plane.
- Core resource-read pagination ownership remains owned by the resource plane.
