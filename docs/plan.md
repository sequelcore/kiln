# Multimodal Documentation Retirement Closeout

Status: completed on 2026-05-13.

The completed multimodal transport foundation has been absorbed into canonical
architecture documentation and removed from the active roadmap set. Remaining
roadmap identifiers were intentionally left stable.

## Completed Changes

- Added `docs/architecture/multimodal-transport.md` as the canonical
  architecture record for multimodal artifacts, route admission, transforms,
  capability delegation, provider constraints, surface projection, and replay
  evidence.
- Updated `docs/architecture/README.md` so readers can discover the canonical
  multimodal architecture page.
- Updated `docs/roadmap/README.md` so completed multimodal work is listed under
  completed programs instead of active roadmaps.
- Updated `docs/roadmap/00.07-agent-qa-showcase-recorder.md` so the recorder
  track depends on the completed canonical multimodal foundation, not an active
  neighboring roadmap.
- Updated `docs/roadmap/03-native-browser-host-decision.md` and
  `docs/research/README.md` so their sequencing language treats multimodal as
  a completed foundation.
- Deleted the retired multimodal roadmap file after stable doctrine was
  represented by canonical docs and ADR-010.

## Decisions

- Do not renumber existing roadmap files. Roadmap identifiers are durable track
  identifiers; compact numbering would create avoidable churn.
- Do not preserve the completed roadmap as an archive in `docs/roadmap`.
  Completed doctrine belongs in `docs/architecture/`, `docs/guides/`, and ADRs.
- Do not add compatibility language, legacy wrappers, or planned-work framing
  for completed implementation.

## Verification Criteria

- No active roadmap reference points to the retired multimodal roadmap.
- `docs/roadmap/README.md` lists the multimodal foundation as completed.
- `docs/architecture/README.md` links the new canonical architecture page.
- `rg -n "00\\.06" docs packages` returns no references.
- `bun run typecheck` passes.
