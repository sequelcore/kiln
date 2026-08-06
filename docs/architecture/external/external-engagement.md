# External Engagement

External engagement is Kiln's governed boundary for external community
signals and future public platform actions.

## Boundary

`@kilnai/core` owns provider-neutral contracts:

- bounded discovery scope;
- external evidence report;
- request budget;
- community signals;
- feature candidates;
- candidate decisions;
- feature intake;
- external action proposal;
- external action approval;
- external action execution.

Provider adapters own platform IO. The first adapter is X in `@kilnai/cli`.
Adapters may fetch evidence only inside an explicit discovery or report scope.
They must not infer write authority from read credentials, model output, or
candidate decisions.

## Read Flow

```text
Discover -> Read Evidence -> Extract Signals -> Review -> Decide -> Promote
```

Discovery is bounded by provider, method, query, search scope, maximum root
posts, maximum replies, optional time window, optional request budget, and
recorded sampling limitations. Evidence reports are artifacts that can be used
by CLI, SDK, GUI, TUI, or runtime surfaces without re-running provider reads.

## Action Flow

```text
Propose Action -> Approve Authority -> Execute
```

Public writes mutate external state. Execution requires an approval record with
an explicit authority actor:

- `human`
- `designated_agent`
- `policy`

The proposer must not approve its own external action. Execution records must
carry proposal id, approval id, provider, action kind, status, and audit trail.
No current X adapter executes public writes.

## Security

Credentials cross the provider-agnostic `SecretRef` boundary. Secret values
must not appear in reports, logs, docs, tests, or cache keys. Public fixtures
must use synthetic source ids and source URLs.
