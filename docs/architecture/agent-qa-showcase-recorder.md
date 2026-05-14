# Agent QA Showcase Recorder

Status: canonical architecture. The implementation roadmap was completed on
2026-05-14 and retired from `docs/roadmap`.

## Purpose

The Agent QA Showcase Recorder turns governed Kiln agent runs into real QA and
showcase videos. Recorder output should look like a polished screen recording
with cursor movement, clicks, typing, scroll, zooms, captions, optional
voiceover, and external-editor handoff artifacts. Screenshots remain evidence
and fallback frames; they are not the primary video format.

Kiln already owns the structured action timeline for agent runs: tool calls,
browser sessions, computer actions, selectors, coordinates, URLs, window
targets, timestamps, artifacts, errors, and final outcomes. The recorder uses
that governed event evidence together with actual capture artifacts so videos
are explainable, editable, replayable, and audit-backed.

## Canonical Recording Model

A recorder session is represented as a multi-track capture manifest:

- Raw capture track: real browser, desktop, or external-media capture evidence.
- Event track: tool calls, selectors, coordinates, clicks, typing, scroll,
  navigation, application/window targets, and timestamps.
- Artifact track: screenshots, DOM/accessibility snapshots, logs, resource
  links, and error evidence.
- Edit track: zoom keyframes, pan targets, captions, cuts, cursor emphasis,
  redactions, aspect ratio choices, background intent, and voiceover.
- Export track: WebM/MP4 media, caption sidecars, marker metadata, QA reports,
  replay manifests, and neutral editor-project handoff artifacts.
- Replay track: manifest, event, and timeline resources needed by surfaces that
  inspect or reconstruct the run.

The resource plane is the durable storage boundary. Recorder artifacts use
`kiln://artifacts/.../content` URIs, session-scoped retention, and explicit
metadata so GUI, TUI, CLI, SDK, and future native surfaces can project the same
evidence without copying blobs into prompt or transcript text.

## Browser Capture

For governed `browser_*` sessions, recorder capture uses a runtime-owned
browser session and correlates frame evidence with browser tool metadata.

The implemented baseline supports:

- governed Playwright browser-session capture
- raw capture and event-track manifest creation
- artifact-backed browser frame evidence
- transcript screenshot galleries attached to tool-call context
- automatic click-centered captions and zoom edit tracks
- WebM export from frame-stream evidence
- exported manifests that preserve raw/event/artifact/edit/video tracks

Embedded in-app browser capture is a future backend, not a recorder
prerequisite. Real video can be recorded from a runtime-owned browser session
before Kiln has a native embedded browser view. Future embedded browser work is
owned by `docs/roadmap/03-embedded-browser-host-capability.md` and
`docs/roadmap/04-embedded-browser-operator-surface.md`.

## Computer Capture

For governed `computer_*` sessions, recorder capture observes the active target
window or desktop region only when runtime policy allows it.

The implemented baseline supports:

- Windows computer capture proof artifacts
- policy and provider checks before capture
- computer action event tracks
- active window or desktop capture metadata
- fail-closed behavior when capture permission, target authorization, or the
  platform provider is unavailable

Computer capture remains governed by runtime provider authority. The recorder
observes and records evidence; it does not bypass tool policy or create a
private desktop-control path.

## Auto-Edit Model

The first-pass edit is derived from manifest evidence, not from ungoverned
pixel inference alone.

Implemented edit-track capabilities include:

- captions from browser/computer tool metadata and renderer output
- click-based automatic zooms
- cut markers for timeline trimming
- cursor emphasis metadata
- redaction edit markers
- local GUI timeline adjustment for zoom, cut, caption, and redaction edits

Operators can inspect and adjust the local timeline view, while durable truth
continues to live in recorder manifests and artifact resources.

## Voice And Audio

Voice is a separate recorder capability track rather than a recorder
prerequisite.

Implemented voice evidence includes:

- voice input records for operator prompts and corrections
- TTS narration records from scripts or step summaries
- microphone capture records for human narration
- voiceover edit tracks that reference artifact-backed audio resources

Voice tracks remain governed artifacts. They should be handled like other
sensitive capture outputs with bounded retention and explicit resource links.

## External Editor Bridge

Professional video editors are integration targets, not the core rendering
engine.

The implemented neutral editor handoff emits:

- SRT captions
- VTT captions
- marker JSON with edit and event timing
- neutral `editor-project` JSON
- project metadata JSON
- export-track provenance that links the generated sidecars back to manifest
  evidence

This bridge deliberately avoids DaVinci Resolve, Premiere, or other
vendor-specific automation in the core recorder. Future editor-specific mappers
may consume the neutral handoff artifacts and call official editor scripting or
plugin APIs, but `computer_*` control of a video editor is only an optional
assisted workflow.

## Security And Governance

Recorder behavior is governed by the same runtime authority boundaries as the
captured agent work.

Required invariants:

- Recording requires explicit operator or project policy.
- Raw captures, audio, frame streams, and exports are sensitive artifacts.
- Retention is bounded at the artifact namespace level.
- Redaction must happen before export when metadata marks fields, text, or
  regions as sensitive.
- Browser and computer automation authority remains in runtime providers.
- Recorder manifests preserve audit evidence for what was captured, edited,
  exported, and replayed.
- Surfaces render resource links and summaries; they do not become the source
  of recorder truth.

Fail closed when provider capture, artifact storage, source media, or policy
checks are unavailable.

## Implemented Surfaces

The completed recorder platform covers:

- shared capture manifest contracts for raw capture, event, artifact, edit,
  export, and replay tracks
- governed browser raw-capture proof
- transcript capture gallery for screenshot evidence
- basic WebM renderer for browser runs
- governed Windows computer capture proof
- local timeline editor for zoom/cut/caption/redaction adjustments
- voice input, TTS narration, microphone capture, and voiceover tracks
- external editor sidecars and neutral editor-project handoff artifacts

Future work can extend quality, additional capture backends, and
editor-specific import helpers, but the stable recorder architecture and
completed implementation baseline now live here rather than in an active
roadmap file.
