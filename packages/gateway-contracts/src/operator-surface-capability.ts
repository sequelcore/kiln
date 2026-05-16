import { z } from "zod";

export const OPERATOR_SURFACE_KINDS = [
  "cli",
  "tui",
  "gui",
  "native",
  "ide",
  "sdk",
  "widget",
  "gateway",
  "runtime",
] as const;

export type OperatorSurfaceKind = (typeof OPERATOR_SURFACE_KINDS)[number];

export const OPERATOR_SURFACE_CAPABILITIES = [
  "gateway-attach",
  "session-projection",
  "theme-projection",
  "workspace-projection",
  "browser-snapshot-monitor",
  "browser-frame-stream",
  "embedded-browser-host",
  "native-cockpit-contract",
  "native-window-lifecycle",
  "surface-performance-telemetry",
  "voice-input-capture",
  "voice-output-playback",
  "voice-output-on-demand",
] as const;

export type OperatorSurfaceCapability = (typeof OPERATOR_SURFACE_CAPABILITIES)[number];

export const OPERATOR_SURFACE_CAPABILITY_STATUSES = [
  "available",
  "unavailable",
  "unsupported",
] as const;

export type OperatorSurfaceCapabilityStatus = (typeof OPERATOR_SURFACE_CAPABILITY_STATUSES)[number];

export const OperatorSurfaceCapabilityEntrySchema = z.object({
  capability: z.enum(OPERATOR_SURFACE_CAPABILITIES),
  status: z.enum(OPERATOR_SURFACE_CAPABILITY_STATUSES),
  reason: z.string().optional(),
});

export type OperatorSurfaceCapabilityEntry = z.infer<typeof OperatorSurfaceCapabilityEntrySchema>;

export const OperatorSurfaceCapabilitySnapshotSchema = z.object({
  surface: z.enum(OPERATOR_SURFACE_KINDS),
  surfaceId: z.string().min(1),
  generatedAt: z.string().optional(),
  capabilities: z.array(OperatorSurfaceCapabilityEntrySchema),
});

export type OperatorSurfaceCapabilitySnapshot = z.infer<typeof OperatorSurfaceCapabilitySnapshotSchema>;

export function operatorSurfaceCapabilityStatus(
  snapshot: OperatorSurfaceCapabilitySnapshot,
  capability: OperatorSurfaceCapability,
): OperatorSurfaceCapabilityEntry {
  return snapshot.capabilities.find((entry) => entry.capability === capability) ?? {
    capability,
    status: "unsupported",
    reason: "Capability is not advertised by this operator surface.",
  };
}

export function operatorSurfaceSupports(
  snapshot: OperatorSurfaceCapabilitySnapshot,
  capability: OperatorSurfaceCapability,
): boolean {
  return operatorSurfaceCapabilityStatus(snapshot, capability).status === "available";
}
