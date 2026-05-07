# Presentation Intent Contract

Status: Active
Opened: 2026-05-07

## Objective

Define a canonical presentation-intent contract so agents and tools can propose
how results should be displayed without controlling UI implementation. Kiln
surfaces then render the same validated intent in GUI, TUI, CLI, SDK/widget,
and future operator surfaces.

The goal is richer operator output without ad hoc markdown tables, duplicated
surface-specific rendering logic, arbitrary HTML, or tool-specific UI hacks.

## Background

Ehrlich proved a useful primitive: tool outputs can emit structured
visualization payloads, the backend can convert them into events, and the
frontend can render them through a registry. Kiln should generalize that idea
for agent and tool results, but with a stricter product contract:

- Agents may propose a presentation intent.
- Kiln validates the intent against a closed schema.
- Surfaces render with native components and graceful fallbacks.
- The same semantic result remains inspectable as data, not only as visual UI.

## Scope

- Add a canonical `PresentationIntent` contract to the shared event/tool
  presentation layer.
- Support a small initial intent set:
  - `summary`
  - `comparison_table`
  - `risk_matrix`
  - `timeline`
  - `resource_bundle`
  - `diagnostic_report`
- Extend managed child comparison to produce a validated `comparison_table`
  intent for route/provider/model/profile/status/substantive-evidence results.
- Add shared projection from tool/session outputs to presentation intents.
- Render supported intents in GUI with compact, accessible components.
- Render the same intents in CLI/TUI as deterministic text/table output.
- Expose the validated intent unchanged through SDK/widget contracts.
- Preserve existing fallback rendering for outputs that do not include a valid
  intent.

## Non-Goals

- Do not allow agents to emit HTML, CSS, JavaScript, JSX, SVG, or executable UI.
- Do not let providers choose arbitrary React components.
- Do not create separate per-surface presentation schemas.
- Do not make markdown tables the canonical data model.
- Do not encode domain-specific UI from external projects as Kiln defaults.
- Do not add third-party visualization/plugin packs in this slice.
- Do not make presentation intents grant tool, memory, filesystem, network, or
  authority privileges.

## Contract Shape

The first contract should be data-first and closed:

```ts
type PresentationIntent =
  | SummaryPresentationIntent
  | ComparisonTablePresentationIntent
  | RiskMatrixPresentationIntent
  | TimelinePresentationIntent
  | ResourceBundlePresentationIntent
  | DiagnosticReportPresentationIntent;
```

Every intent includes:

- `kind`
- `title`
- optional `summary`
- optional `source`
- optional `confidence`
- optional `resourceLinks`

Table-like intents include typed columns and rows. Risk-like intents include
severity, confidence, evidence, and recommendation fields. Timeline-like
intents include timestamp/order, label, status, and related resource ids.

Unknown fields fail validation unless explicitly reserved in the contract.

## Architecture Rules

- The canonical type belongs in shared contracts, not GUI.
- `operator-event-presentation` remains the projection boundary from raw events
  and tool envelopes into user-facing presentation.
- Runtime/tool execution stores the raw result and the validated intent.
- GUI/TUI/CLI renderers consume only validated presentation intent.
- Surfaces that cannot render a rich intent must degrade to deterministic text,
  not raw JSON.
- Invalid intents are ignored with diagnostics; the underlying result still
  renders through the current fallback path.
- Tests must cover the contract, projection, GUI rendering, CLI/TUI fallback,
  invalid-intent rejection, and SDK/widget pass-through.

## First Implementation Slice

1. Add `PresentationIntent` types and validators in the shared
   gateway/operator contract package.
2. Add `presentationIntent` to `ToolResultPresentation` or introduce a
   sibling field if that keeps the existing contract cleaner.
3. Teach `operator-event-presentation` to extract a validated intent from
   structured tool envelopes.
4. Implement `comparison_table` rendering in GUI and text fallback for CLI/TUI.
5. Use managed child comparison as the first real producer:
   route id, provider, model, profile, context mode, status, substantive
   evidence, and failure reason.
6. Add tests for all supported surfaces and invalid intent rejection.

## Acceptance Criteria

- Managed child comparison can render as a validated comparison table without
  relying on ad hoc markdown.
- GUI, TUI, CLI, and SDK/widget receive the same semantic presentation data.
- Unsupported or invalid presentation intents fail closed to existing fallback
  rendering.
- No surface has its own divergent schema or type registry.
- No executable or arbitrary UI content can be supplied by the model.
- Raw result, resource links, and audit evidence remain inspectable.
- Focused tests cover contract validation, projection, GUI rendering, text
  fallback, and rejection behavior.

## Deferred Extensions

- Additional chart/graph intents after the table/report contract stabilizes.
- Operator-custom presentation preferences.
- Domain-specific visualization packs.
- Third-party presentation plugins with provenance and trust scanning.
