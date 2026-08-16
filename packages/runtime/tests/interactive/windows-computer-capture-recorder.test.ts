import { describe, expect, it } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import {
  WindowsComputerCaptureRecorder,
} from "../../src/index.js";

describe("WindowsComputerCaptureRecorder", () => {
  it("creates screenshot evidence, event track, and manifest artifacts from governed Windows computer capture", () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T17:00:05.000Z" });
    const recorder = new WindowsComputerCaptureRecorder({ artifactStore });

    recorder.recordComputerOperation({
      sessionId: "computer-1",
      toolName: "computer_observe",
      operation: "observe",
      startedAt: "2026-05-14T17:00:00.000Z",
      completedAt: "2026-05-14T17:00:00.100Z",
      status: "succeeded",
      provider: "windows-nutjs",
      application: "Calculator",
      windowTitle: "Calculator",
      screenshotDataUrl: "data:image/png;base64,AQID",
      width: 1920,
      height: 1080,
      allowedApplications: ["Calculator"],
    });
    recorder.recordComputerOperation({
      sessionId: "computer-1",
      toolName: "computer_click",
      operation: "click",
      startedAt: "2026-05-14T17:00:00.250Z",
      completedAt: "2026-05-14T17:00:00.400Z",
      status: "succeeded",
      provider: "windows-nutjs",
      application: "Calculator",
      windowTitle: "Calculator",
      action: { type: "click", x: 320, y: 240, button: "left" },
      allowedApplications: ["Calculator"],
    });
    recorder.recordComputerOperation({
      sessionId: "computer-1",
      toolName: "computer_type",
      operation: "type",
      startedAt: "2026-05-14T17:00:00.500Z",
      completedAt: "2026-05-14T17:00:00.700Z",
      status: "succeeded",
      provider: "windows-nutjs",
      application: "Calculator",
      windowTitle: "Calculator",
      action: { type: "type", textLength: 8, sensitive: true },
      sensitive: true,
      allowedApplications: ["Calculator"],
    });

    const proof = recorder.finalizeSession("computer-1", {
      completedAt: "2026-05-14T17:00:01.000Z",
      title: "Windows Calculator proof",
    });

    expect(proof).toMatchObject({
      sessionId: "computer-1",
      manifestId: "computer-1-recorder-manifest",
      frameCount: 1,
      eventCount: 3,
    });
    expect(proof.frameArtifactUris).toHaveLength(1);

    const frameArtifact = readArtifact(artifactStore, proof.frameArtifactUris[0]!);
    expect(frameArtifact).toMatchObject({
      title: "Windows computer frame: computer-1 #1",
      mimeType: "image/png",
      content: { type: "blob", blob: "AQID" },
    });

    const rawEvidence = readJsonArtifact(artifactStore, proof.rawCaptureEvidenceUri);
    expect(rawEvidence).toMatchObject({
      version: "windows-computer-raw-capture.v1",
      sessionId: "computer-1",
      startedAt: "2026-05-14T17:00:00.100Z",
      completedAt: "2026-05-14T17:00:01.000Z",
      frameCount: 1,
      frames: [{
        artifactUri: proof.frameArtifactUris[0],
        capturedAt: "2026-05-14T17:00:00.100Z",
        offsetMs: 0,
        operation: "observe",
        transport: "desktop-capture",
        provider: "windows-nutjs",
        application: "Calculator",
        windowTitle: "Calculator",
        width: 1920,
        height: 1080,
      }],
    });

    const eventTrack = readJsonArtifact(artifactStore, proof.eventTrackUri);
    expect(eventTrack).toMatchObject({
      version: "windows-computer-event-track.v1",
      sessionId: "computer-1",
      events: [{
        toolName: "computer_observe",
        operation: "observe",
        startedAt: "2026-05-14T17:00:00.000Z",
        completedAt: "2026-05-14T17:00:00.100Z",
        offsetMs: 0,
        durationMs: 100,
        status: "succeeded",
      }, {
        toolName: "computer_click",
        operation: "click",
        offsetMs: 150,
        durationMs: 150,
        x: 320,
        y: 240,
        button: "left",
      }, {
        toolName: "computer_type",
        operation: "type",
        offsetMs: 400,
        durationMs: 200,
        textLength: 8,
        sensitive: true,
      }],
    });
    expect(JSON.stringify(eventTrack)).not.toContain("password");

    const manifest = readJsonArtifact(artifactStore, proof.manifestUri);
    expect(manifest).toMatchObject({
      manifestId: "computer-1-recorder-manifest",
      kilnSessionId: "computer-1",
      title: "Windows Calculator proof",
      status: "captured",
      policy: {
        recordingConsent: "operator-approved",
        redaction: { status: "pending", sensitive: true },
      },
      timeline: {
        startedAt: "2026-05-14T17:00:00.100Z",
        durationMs: 900,
      },
      tracks: {
        rawCapture: [{
          id: "computer-1-raw-capture",
          source: {
            kind: "computer_session",
            target: "computer",
            sessionId: "computer-1",
            application: "Calculator",
            windowTitle: "Calculator",
          },
          capture: {
            transport: "desktop-capture",
            format: "application/vnd.kiln.windows-computer.frame-stream+json",
            resource: {
              uri: proof.rawCaptureEvidenceUri,
              relation: "raw_capture",
              mimeType: "application/json",
            },
          },
        }],
        events: [{
          id: "computer-1-computer-events",
          eventKinds: ["computer_observe", "computer_click", "computer_type"],
          resource: {
            uri: proof.eventTrackUri,
            relation: "events",
            mimeType: "application/json",
          },
        }],
        artifacts: [{
          id: "computer-1-computer-frame-artifacts",
          artifactUris: proof.frameArtifactUris,
          relation: "source_evidence",
        }],
      },
    });
  });

  it("keeps proof artifacts readable when recorder retention is below the proof footprint", () => {
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T18:00:05.000Z" });
    const recorder = new WindowsComputerCaptureRecorder({
      artifactStore,
      retentionMaxArtifacts: 1,
    });

    recorder.recordComputerOperation({
      sessionId: "computer-low-retention",
      toolName: "computer_observe",
      operation: "observe",
      startedAt: "2026-05-14T18:00:00.000Z",
      completedAt: "2026-05-14T18:00:00.100Z",
      status: "succeeded",
      provider: "windows-nutjs",
      application: "Calculator",
      screenshotDataUrl: "data:image/png;base64,AQID",
    });

    const proof = recorder.finalizeSession("computer-low-retention", {
      completedAt: "2026-05-14T18:00:01.000Z",
    });

    expect(readArtifact(artifactStore, proof.frameArtifactUris[0]!).mimeType).toBe("image/png");
    expect(readArtifact(artifactStore, proof.rawCaptureEvidenceUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, proof.eventTrackUri).mimeType).toBe("application/json");
    expect(readArtifact(artifactStore, proof.manifestUri).mimeType).toBe("application/json");
  });

  it("fails closed when external screenshot URI evidence is missing or not an image artifact", () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const recorder = new WindowsComputerCaptureRecorder({ artifactStore });
    const jsonArtifact = artifactStore.put({
      namespace: "manual-computer-evidence",
      title: "not a screenshot",
      mimeType: "application/json",
      content: { type: "json", value: { ok: true } },
      producer: { kind: "tool", name: "test" },
      retention: { scope: "session", maxArtifacts: 10 },
    });
    const jsonUri = `kiln://artifacts/${jsonArtifact.namespace}/${jsonArtifact.id}/content`;

    expect(() => recorder.recordComputerOperation({
      sessionId: "computer-non-image",
      toolName: "computer_observe",
      operation: "observe",
      startedAt: "2026-05-14T18:30:00.000Z",
      completedAt: "2026-05-14T18:30:00.100Z",
      status: "succeeded",
      provider: "windows-nutjs",
      screenshotUri: jsonUri,
    })).toThrow("Windows computer capture screenshotUri must reference an image artifact.");

    expect(() => recorder.recordComputerOperation({
      sessionId: "computer-missing-image",
      toolName: "computer_observe",
      operation: "observe",
      startedAt: "2026-05-14T18:31:00.000Z",
      completedAt: "2026-05-14T18:31:00.100Z",
      status: "succeeded",
      provider: "windows-nutjs",
      screenshotUri: "kiln://artifacts/missing-screenshots/frame-1/content",
    })).toThrow("Windows computer capture screenshotUri artifact is missing.");
  });

  it("fails closed when finalizing without captured screenshot evidence", () => {
    const artifactStore = new MemoryArtifactResourceStore();
    const recorder = new WindowsComputerCaptureRecorder({ artifactStore });

    recorder.recordComputerOperation({
      sessionId: "computer-empty",
      toolName: "computer_click",
      operation: "click",
      startedAt: "2026-05-14T19:00:00.000Z",
      completedAt: "2026-05-14T19:00:00.100Z",
      status: "succeeded",
      provider: "windows-nutjs",
      action: { type: "click", x: 1, y: 2 },
    });

    expect(() => recorder.finalizeSession("computer-empty", {
      completedAt: "2026-05-14T19:00:01.000Z",
    })).toThrow("Cannot finalize Windows computer capture proof without raw capture frames.");
  });
});

function readArtifact(artifactStore: MemoryArtifactResourceStore, uri: string) {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  const artifact = artifactStore.get(match[1]!, match[2]!);
  if (!artifact) {
    throw new Error(`Missing artifact: ${uri}`);
  }
  return artifact;
}

function readJsonArtifact(artifactStore: MemoryArtifactResourceStore, uri: string): Record<string, unknown> {
  const artifact = readArtifact(artifactStore, uri);
  if (artifact.content.type !== "json") {
    throw new Error(`Expected JSON artifact: ${uri}`);
  }
  return artifact.content.value as Record<string, unknown>;
}
