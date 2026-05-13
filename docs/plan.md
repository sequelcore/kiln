# Roadmap 06 Pre-Slice 0 Plan

Objective: start `docs/roadmap/00.06-live-browser-operator-surface.md` with
the Transcript Snapshot Gallery pre-slice. Browser screenshot evidence must
appear beside the transcript tool call that produced it while keeping image
payloads in the resource plane.

Non-goals:

- Do not implement live browser viewport streaming.
- Do not make the GUI Browser tab the source of screenshot authority.
- Do not persist inline `data:image/...` payloads in transcript events.
- Do not add compatibility fallbacks for older private screenshot shapes.

Surface map:

- `packages/core/src/tools/infrastructure/interactive-use-tool.ts` already
  materializes screenshot data URLs as `kiln://artifacts/.../content`
  resources and emits `resourceLinks` with `relation: "snapshot"`.
- `packages/core/src/tools/domain/tool-result-metadata.ts` and
  `packages/core/src/tools/domain/tool-resource-display.ts` own shared
  resource-link metadata and display projection.
- `packages/runtime/src/gateway/gui-gateway.ts` already carries
  `metadata.resourceLinks` into `tool_call_completed` session events.
- `packages/gateway-contracts/src/operator-event-presentation.ts` owns the
  shared tool-result presentation consumed by GUI, TUI, CLI, SDK, and replay.
- `packages/gui/src/components/transcript.tsx` renders
  `toolPresentation.resourceLinks` in transcript tool rows.

Implementation slices:

1. Contract and core metadata:
   Add optional resource-link sequence/label metadata for interactive browser
   screenshots and preserve it through `ToolResourceDisplayDescriptor`.

2. Shared presentation:
   Project browser `interactive` snapshot links as image/gallery evidence with
   stable `Capture N` labels, resource URIs, title, MIME type, relation, and
   raw availability.

3. GUI transcript:
   Render browser snapshot resources as a compact transcript gallery attached
   to the tool-call row, while generic resource links keep their current
   presentation.

Test-first sequence:

1. Add failing core tests proving browser screenshot resource links include
   stable capture labels and sequence metadata without inline data URLs.
2. Add failing gateway-contract tests proving `browser_*` snapshot results
   project as image/gallery tool presentations with numbered resource links.
3. Add failing GUI transcript tests proving multiple browser screenshots render
   as `Capture 1`, `Capture 2` gallery items and do not expose raw JSON.
4. Add or extend terminal projection tests only if the shared summary does not
   already provide numbered resource-link text.

Verification gates:

- `bun test packages/core/tests/tools/infrastructure/interactive-use-tool.test.ts`
- `bun test packages/core/tests/tools/domain/tool-resource-display.test.ts`
- `bun test packages/gateway-contracts/tests/operator-event-presentation.test.ts`
- `bun test packages/gui/tests/transcript.test.tsx`
- `bun test packages/tui/tests/gateway-session.test.ts`
- `bun run typecheck`
- GUI browser/dev-server verification only if layout changes require browser
  inspection beyond component tests.

Residual risks:

- Capture numbering is only stable if it is stored in shared metadata before
  replay. GUI-only numbering is not acceptable.
- Existing artifact IDs are session-scoped, so mixed browser/computer
  screenshot streams may not be contiguous per browser session until a future
  browser-session-owned counter exists.
