export const RECORDER_CAPTURE_MANIFEST_VERSION = "recorder-manifest.v1" as const;

export const RECORDER_CAPTURE_TRACK_KINDS = [
  "raw_capture",
  "event",
  "artifact",
  "edit",
  "export",
  "replay",
] as const;

export type RecorderCaptureManifestVersion = typeof RECORDER_CAPTURE_MANIFEST_VERSION;
export type RecorderCaptureTrackKind = typeof RECORDER_CAPTURE_TRACK_KINDS[number];
export type RecorderCaptureManifestStatus = "planned" | "capturing" | "captured" | "rendered" | "exported" | "failed";
export type RecorderRecordingConsent = "operator-approved" | "project-policy";
export type RecorderRedactionStatus = "not_required" | "pending" | "applied" | "failed";
export type RecorderTimelineTimebase = "relative-ms";
export type RecorderTrackStatus = "planned" | "capturing" | "captured" | "ready" | "failed";
export type RecorderCaptureTarget = "browser" | "computer" | "operator_surface" | "external_media";
export type RecorderCaptureSourceKind = "browser_session" | "computer_session" | "operator_surface" | "external_media";
export type RecorderCaptureTransport =
  | "browser-native"
  | "computer-native"
  | "window-capture"
  | "desktop-capture"
  | "frame-stream"
  | "external-media";
export type RecorderResourceRelation = "raw_capture" | "events" | "source_evidence" | "edit" | "export" | "replay" | "summary";
export type RecorderArtifactRelation = "source_evidence" | "fallback_frame" | "diagnostic" | "redaction";
export type RecorderEditKind = "auto_zoom" | "pan" | "cut" | "caption" | "cursor_emphasis" | "redaction" | "voiceover";
export type RecorderExportFormat = "mp4" | "webm" | "json" | "srt" | "vtt" | "editor-project";
export type RecorderReplayKind = "manifest" | "session_events" | "timeline";
export type RecorderEvidenceKind = "session_event" | "tool_call" | "artifact" | "timeline_marker";

export interface RecorderRetentionPolicy {
  readonly scope: "session";
  readonly maxArtifacts?: number;
}

export interface RecorderRedactionPolicy {
  readonly status: RecorderRedactionStatus;
  readonly sensitive: boolean;
  readonly evidenceUris?: readonly string[];
}

export interface RecorderCapturePolicy {
  readonly recordingConsent: RecorderRecordingConsent;
  readonly retention: RecorderRetentionPolicy;
  readonly redaction: RecorderRedactionPolicy;
}

export interface RecorderTimeline {
  readonly timebase: RecorderTimelineTimebase;
  readonly startedAt?: string;
  readonly durationMs?: number;
}

export interface RecorderResourceReference {
  readonly uri: string;
  readonly relation: RecorderResourceRelation;
  readonly title?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

export interface RecorderEvidenceReference {
  readonly kind: RecorderEvidenceKind;
  readonly id: string;
  readonly uri?: string;
  readonly sequence?: number;
}

export interface RecorderTrackBase<TKind extends RecorderCaptureTrackKind> {
  readonly id: string;
  readonly kind: TKind;
  readonly status?: RecorderTrackStatus;
  readonly evidence?: readonly RecorderEvidenceReference[];
}

export interface RecorderCaptureSource {
  readonly kind: RecorderCaptureSourceKind;
  readonly target: RecorderCaptureTarget;
  readonly sessionId?: string;
  readonly application?: string;
  readonly windowTitle?: string;
  readonly url?: string;
}

export interface RecorderRawCaptureSegment {
  readonly transport: RecorderCaptureTransport;
  readonly format: string;
  readonly startedAtOffsetMs: number;
  readonly durationMs?: number;
  readonly resource: RecorderResourceReference;
}

export interface RecorderRawCaptureTrack extends RecorderTrackBase<"raw_capture"> {
  readonly source: RecorderCaptureSource;
  readonly capture: RecorderRawCaptureSegment;
}

export interface RecorderEventTrack extends RecorderTrackBase<"event"> {
  readonly eventKinds: readonly string[];
  readonly startedAtOffsetMs?: number;
  readonly durationMs?: number;
  readonly resource: RecorderResourceReference;
}

export interface RecorderArtifactTrack extends RecorderTrackBase<"artifact"> {
  readonly artifactUris: readonly string[];
  readonly relation: RecorderArtifactRelation;
}

export interface RecorderViewportRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RecorderEditTrack extends RecorderTrackBase<"edit"> {
  readonly editKind: RecorderEditKind;
  readonly startedAtOffsetMs: number;
  readonly durationMs?: number;
  readonly target?: RecorderViewportRegion;
  readonly text?: string;
  readonly resource?: RecorderResourceReference;
}

export interface RecorderExportTrack extends RecorderTrackBase<"export"> {
  readonly format: RecorderExportFormat;
  readonly aspectRatio?: "16:9" | "9:16" | "1:1" | string;
  readonly resource: RecorderResourceReference;
}

export interface RecorderReplayTrack extends RecorderTrackBase<"replay"> {
  readonly replayKind: RecorderReplayKind;
  readonly resource: RecorderResourceReference;
  readonly sourceTrackIds: readonly string[];
}

export interface RecorderCaptureManifestTracks {
  readonly rawCapture: readonly RecorderRawCaptureTrack[];
  readonly events: readonly RecorderEventTrack[];
  readonly artifacts: readonly RecorderArtifactTrack[];
  readonly edits: readonly RecorderEditTrack[];
  readonly exports: readonly RecorderExportTrack[];
  readonly replay: readonly RecorderReplayTrack[];
}

export interface RecorderCaptureManifest {
  readonly version: RecorderCaptureManifestVersion;
  readonly manifestId: string;
  readonly kilnSessionId: string;
  readonly title?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: RecorderCaptureManifestStatus;
  readonly policy: RecorderCapturePolicy;
  readonly timeline: RecorderTimeline;
  readonly tracks: RecorderCaptureManifestTracks;
}

export type RecorderCaptureManifestInput =
  Omit<RecorderCaptureManifest, "version"> & {
    readonly version?: RecorderCaptureManifestVersion;
  };

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function createRecorderCaptureManifest(input: RecorderCaptureManifestInput): RecorderCaptureManifest {
  if (!input || typeof input !== "object") {
    throw new Error("Recorder manifest input is required.");
  }
  assertAllowedKeys(input, [
    "version",
    "manifestId",
    "kilnSessionId",
    "title",
    "createdAt",
    "updatedAt",
    "status",
    "policy",
    "timeline",
    "tracks",
  ], "input");
  if (input.version !== undefined && input.version !== RECORDER_CAPTURE_MANIFEST_VERSION) {
    throw new Error(`Recorder manifest version must be ${RECORDER_CAPTURE_MANIFEST_VERSION}.`);
  }
  requireText(input.manifestId, "manifestId");
  requireText(input.kilnSessionId, "kilnSessionId");
  validateIsoTimestamp(input.createdAt, "createdAt");
  validateIsoTimestamp(input.updatedAt, "updatedAt");
  requireOneOf(input.status, ["planned", "capturing", "captured", "rendered", "exported", "failed"], "status");
  validatePolicy(input.policy);
  validateTimeline(input.timeline);
  validateTracks(input.tracks);

  return {
    version: RECORDER_CAPTURE_MANIFEST_VERSION,
    manifestId: input.manifestId,
    kilnSessionId: input.kilnSessionId,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    status: input.status,
    policy: input.policy,
    timeline: input.timeline,
    tracks: input.tracks,
  };
}

function validatePolicy(policy: RecorderCapturePolicy): void {
  if (!policy || typeof policy !== "object") {
    throw new Error("Recorder manifest policy is required.");
  }
  assertAllowedKeys(policy, ["recordingConsent", "retention", "redaction"], "policy");
  requireOneOf(policy.recordingConsent, ["operator-approved", "project-policy"], "policy.recordingConsent");
  if (!policy.retention || policy.retention.scope !== "session") {
    throw new Error("Recorder manifest policy.retention.scope must be session.");
  }
  assertAllowedKeys(policy.retention, ["scope", "maxArtifacts"], "policy.retention");
  if (
    policy.retention.maxArtifacts !== undefined
    && (!Number.isFinite(policy.retention.maxArtifacts) || policy.retention.maxArtifacts <= 0)
  ) {
    throw new Error("Recorder manifest policy.retention.maxArtifacts must be positive.");
  }
  if (!policy.redaction || typeof policy.redaction !== "object") {
    throw new Error("Recorder manifest policy.redaction is required.");
  }
  assertAllowedKeys(policy.redaction, ["status", "sensitive", "evidenceUris"], "policy.redaction");
  requireOneOf(policy.redaction.status, ["not_required", "pending", "applied", "failed"], "policy.redaction.status");
  if (typeof policy.redaction.sensitive !== "boolean") {
    throw new Error("Recorder manifest policy.redaction.sensitive is required.");
  }
  for (const uri of policy.redaction.evidenceUris ?? []) {
    validateKilnUri(uri, "policy.redaction.evidenceUris");
  }
}

function validateTimeline(timeline: RecorderTimeline): void {
  if (!timeline || typeof timeline !== "object") {
    throw new Error("Recorder manifest timeline is required.");
  }
  assertAllowedKeys(timeline, ["timebase", "startedAt", "durationMs"], "timeline");
  requireOneOf(timeline.timebase, ["relative-ms"], "timeline.timebase");
  if (timeline.startedAt !== undefined) validateIsoTimestamp(timeline.startedAt, "timeline.startedAt");
  validateOptionalPositive(timeline.durationMs, "timeline.durationMs");
}

function validateTracks(tracks: RecorderCaptureManifestTracks): void {
  if (!tracks || typeof tracks !== "object") {
    throw new Error("Recorder manifest tracks are required.");
  }
  assertAllowedKeys(tracks, ["rawCapture", "events", "artifacts", "edits", "exports", "replay"], "tracks");
  const rawCapture = requireTrackArray(tracks.rawCapture, "rawCapture");
  const events = requireTrackArray(tracks.events, "events");
  const artifacts = requireTrackArray(tracks.artifacts, "artifacts");
  const edits = requireTrackArray(tracks.edits, "edits");
  const exports = requireTrackArray(tracks.exports, "exports");
  const replay = requireTrackArray(tracks.replay, "replay");
  const trackIds = new Set<string>();

  for (const track of rawCapture) {
    registerTrackId(trackIds, validateTrackBase(track, "raw_capture", "tracks.rawCapture", [
      "id",
      "kind",
      "status",
      "evidence",
      "source",
      "capture",
    ]));
    validateSource(track.source);
    validateRawCaptureSegment(track.capture);
    requireOneOf(track.capture.transport, [
      "browser-native",
      "computer-native",
      "window-capture",
      "desktop-capture",
      "frame-stream",
      "external-media",
    ], "tracks.rawCapture.capture.transport");
    requireText(track.capture.format, "tracks.rawCapture.capture.format");
    validateNonNegative(track.capture.startedAtOffsetMs, "tracks.rawCapture.capture.startedAtOffsetMs");
    validateOptionalPositive(track.capture.durationMs, "tracks.rawCapture.capture.durationMs");
    validateResourceReference(track.capture.resource, "tracks.rawCapture.capture.resource");
  }
  for (const track of events) {
    registerTrackId(trackIds, validateTrackBase(track, "event", "tracks.events", [
      "id",
      "kind",
      "status",
      "evidence",
      "eventKinds",
      "startedAtOffsetMs",
      "durationMs",
      "resource",
    ]));
    if (!Array.isArray(track.eventKinds)) {
      throw new Error("Recorder manifest tracks.events.eventKinds is required.");
    }
    for (const eventKind of track.eventKinds) requireText(eventKind, "tracks.events.eventKinds");
    validateOptionalNonNegative(track.startedAtOffsetMs, "tracks.events.startedAtOffsetMs");
    validateOptionalPositive(track.durationMs, "tracks.events.durationMs");
    validateResourceReference(track.resource, "tracks.events.resource");
  }
  for (const track of artifacts) {
    registerTrackId(trackIds, validateTrackBase(track, "artifact", "tracks.artifacts", [
      "id",
      "kind",
      "status",
      "evidence",
      "artifactUris",
      "relation",
    ]));
    if (!Array.isArray(track.artifactUris)) {
      throw new Error("Recorder manifest tracks.artifacts.artifactUris is required.");
    }
    for (const uri of track.artifactUris) validateKilnUri(uri, "tracks.artifacts.artifactUris");
    requireOneOf(track.relation, ["source_evidence", "fallback_frame", "diagnostic", "redaction"], "tracks.artifacts.relation");
  }
  for (const track of edits) {
    registerTrackId(trackIds, validateTrackBase(track, "edit", "tracks.edits", [
      "id",
      "kind",
      "status",
      "evidence",
      "editKind",
      "startedAtOffsetMs",
      "durationMs",
      "target",
      "text",
      "resource",
    ]));
    requireOneOf(track.editKind, [
      "auto_zoom",
      "pan",
      "cut",
      "caption",
      "cursor_emphasis",
      "redaction",
      "voiceover",
    ], "tracks.edits.editKind");
    validateNonNegative(track.startedAtOffsetMs, "tracks.edits.startedAtOffsetMs");
    validateOptionalPositive(track.durationMs, "tracks.edits.durationMs");
    if (track.target) validateViewportRegion(track.target, "tracks.edits.target");
    if (track.resource) validateResourceReference(track.resource, "tracks.edits.resource");
  }
  for (const track of exports) {
    registerTrackId(trackIds, validateTrackBase(track, "export", "tracks.exports", [
      "id",
      "kind",
      "status",
      "evidence",
      "format",
      "aspectRatio",
      "resource",
    ]));
    requireOneOf(track.format, ["mp4", "webm", "json", "srt", "vtt", "editor-project"], "tracks.exports.format");
    validateResourceReference(track.resource, "tracks.exports.resource");
  }
  for (const track of replay) {
    registerTrackId(trackIds, validateTrackBase(track, "replay", "tracks.replay", [
      "id",
      "kind",
      "status",
      "evidence",
      "replayKind",
      "resource",
      "sourceTrackIds",
    ]));
    requireOneOf(track.replayKind, ["manifest", "session_events", "timeline"], "tracks.replay.replayKind");
    validateResourceReference(track.resource, "tracks.replay.resource");
    if (!Array.isArray(track.sourceTrackIds)) {
      throw new Error("Recorder manifest tracks.replay.sourceTrackIds is required.");
    }
  }
  for (const track of replay) {
    const sourceTrackIds = new Set<string>();
    for (const sourceTrackId of track.sourceTrackIds) {
      requireText(sourceTrackId, "tracks.replay.sourceTrackIds");
      if (sourceTrackId === track.id) {
        throw new Error(`Recorder replay source track id cannot reference its own replay track: ${sourceTrackId}.`);
      }
      if (sourceTrackIds.has(sourceTrackId)) {
        throw new Error(`Duplicate recorder replay source track id: ${sourceTrackId}`);
      }
      sourceTrackIds.add(sourceTrackId);
      if (!trackIds.has(sourceTrackId)) {
        throw new Error(`Recorder replay source track id is unknown: ${sourceTrackId}.`);
      }
    }
  }
}

function validateTrackBase<TKind extends RecorderCaptureTrackKind>(
  track: RecorderTrackBase<TKind>,
  kind: TKind,
  field: string,
  allowedKeys: readonly string[],
): string {
  if (!track || typeof track !== "object") {
    throw new Error(`Recorder manifest ${field} entry is required.`);
  }
  assertAllowedKeys(track, allowedKeys, field);
  requireText(track.id, `${field}.id`);
  if (track.kind !== kind) {
    throw new Error(`Recorder manifest ${field}.kind must be ${kind}.`);
  }
  if (track.status !== undefined) {
    requireOneOf(track.status, ["planned", "capturing", "captured", "ready", "failed"], `${field}.status`);
  }
  for (const evidence of track.evidence ?? []) {
    validateEvidenceReference(evidence, `${field}.evidence`);
  }
  return track.id;
}

function validateSource(source: RecorderCaptureSource): void {
  if (!source || typeof source !== "object") {
    throw new Error("Recorder manifest tracks.rawCapture.source is required.");
  }
  assertAllowedKeys(source, ["kind", "target", "sessionId", "application", "windowTitle", "url"], "tracks.rawCapture.source");
  requireOneOf(source.kind, ["browser_session", "computer_session", "operator_surface", "external_media"], "tracks.rawCapture.source.kind");
  requireOneOf(source.target, ["browser", "computer", "operator_surface", "external_media"], "tracks.rawCapture.source.target");
}

function validateRawCaptureSegment(capture: RecorderRawCaptureSegment): void {
  if (!capture || typeof capture !== "object") {
    throw new Error("Recorder manifest tracks.rawCapture.capture is required.");
  }
  assertAllowedKeys(capture, ["transport", "format", "startedAtOffsetMs", "durationMs", "resource"], "tracks.rawCapture.capture");
}

function validateResourceReference(resource: RecorderResourceReference, field: string): void {
  if (!resource || typeof resource !== "object") {
    throw new Error(`Recorder manifest ${field} is required.`);
  }
  assertAllowedKeys(resource, ["uri", "relation", "title", "mimeType", "sizeBytes"], field);
  validateKilnUri(resource.uri, field);
  requireOneOf(resource.relation, ["raw_capture", "events", "source_evidence", "edit", "export", "replay", "summary"], `${field}.relation`);
  validateOptionalPositive(resource.sizeBytes, `${field}.sizeBytes`);
}

function validateEvidenceReference(evidence: RecorderEvidenceReference, field: string): void {
  if (!evidence || typeof evidence !== "object") {
    throw new Error(`Recorder manifest ${field} entry is required.`);
  }
  assertAllowedKeys(evidence, ["kind", "id", "uri", "sequence"], field);
  requireOneOf(evidence.kind, ["session_event", "tool_call", "artifact", "timeline_marker"], `${field}.kind`);
  requireText(evidence.id, `${field}.id`);
  if (evidence.uri !== undefined) validateKilnUri(evidence.uri, `${field}.uri`);
}

function validateViewportRegion(region: RecorderViewportRegion, field: string): void {
  if (!region || typeof region !== "object") {
    throw new Error(`Recorder manifest ${field} is required.`);
  }
  assertAllowedKeys(region, ["x", "y", "width", "height"], field);
  validateNonNegative(region.x, `${field}.x`);
  validateNonNegative(region.y, `${field}.y`);
  validateOptionalPositive(region.width, `${field}.width`);
  validateOptionalPositive(region.height, `${field}.height`);
}

function requireTrackArray<T>(value: readonly T[] | undefined, field: keyof RecorderCaptureManifestTracks): readonly T[] {
  if (!Array.isArray(value)) {
    throw new Error(`Recorder manifest tracks.${field} is required.`);
  }
  return value;
}

function validateKilnUri(uri: string, field: string): void {
  if (typeof uri !== "string") {
    throw new Error(`Recorder resource URI must use kiln:// (${field}).`);
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Recorder resource URI must use kiln:// (${field}).`);
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname.trim().length === 0) {
    throw new Error(`Recorder resource URI must use kiln:// (${field}).`);
  }
}

function requireText(value: string | undefined, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Recorder manifest ${field} is required.`);
  }
}

function requireOneOf<T extends string>(value: string | undefined, allowed: readonly T[], field: string): void {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Recorder manifest ${field} must be one of: ${allowed.join(", ")}.`);
  }
}

function validateIsoTimestamp(value: string | undefined, field: string): void {
  requireText(value, field);
  const timestamp = value!;
  const parsed = new Date(timestamp);
  if (
    !ISO_TIMESTAMP_PATTERN.test(timestamp)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== timestamp
  ) {
    throw new Error(`Recorder manifest ${field} must be an ISO timestamp.`);
  }
}

function registerTrackId(trackIds: Set<string>, id: string): void {
  if (trackIds.has(id)) {
    throw new Error(`Duplicate recorder track id: ${id}`);
  }
  trackIds.add(id);
}

function validateNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Recorder manifest ${field} must be a non-negative number.`);
  }
}

function validateOptionalNonNegative(value: number | undefined, field: string): void {
  if (value !== undefined) validateNonNegative(value, field);
}

function validateOptionalPositive(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`Recorder manifest ${field} must be a positive number.`);
  }
}

function assertAllowedKeys(value: object, allowedKeys: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`Recorder manifest ${field} contains unknown field: ${key}.`);
    }
  }
}
