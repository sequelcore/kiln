export interface ServiceStatus {
  readonly service: string;
  readonly state: "healthy" | "degraded" | "down";
  readonly signals: readonly string[];
  readonly lastChanged: string;
}

const statuses: Record<string, ServiceStatus> = {
  gateway: {
    service: "gateway",
    state: "degraded",
    signals: ["p95 latency above 2s", "websocket reconnects elevated", "error budget burn 3x"],
    lastChanged: "2026-05-15T16:20:00Z",
  },
  billing: {
    service: "billing",
    state: "healthy",
    signals: ["usage endpoint 200", "queue depth normal"],
    lastChanged: "2026-05-15T15:45:00Z",
  },
  memory: {
    service: "memory",
    state: "degraded",
    signals: ["fts index lag 90s", "write latency elevated"],
    lastChanged: "2026-05-15T16:05:00Z",
  },
};

const runbooks: Record<string, readonly string[]> = {
  gateway: [
    "Check gateway health and provider pool status.",
    "Confirm WebSocket reconnect rate by app and tenant.",
    "If latency is provider-bound, route low-risk traffic to a secondary provider.",
    "Escalate when p95 stays above 2s for more than 15 minutes.",
  ],
  billing: [
    "Check budget endpoint availability.",
    "Compare usage writes against accepted gateway requests.",
    "Pause destructive tools if billing enforcement cannot verify budget.",
  ],
  memory: [
    "Check write latency and FTS index lag.",
    "Confirm tenant isolation before replaying writes.",
    "Prefer degraded recall over cross-tenant fallback.",
  ],
};

const incidents: Array<{ id: string; service: string; severity: string; summary: string; timeline: string[] }> = [];

export function listServices() {
  return Object.keys(statuses);
}

export function getServiceStatus(service: string) {
  return statuses[service] ?? { error: "service_not_found", service };
}

export function getRunbook(service: string, symptom: string) {
  return {
    service,
    symptom,
    steps: runbooks[service] ?? ["No runbook found. Escalate to the service owner."],
  };
}

export function openIncident(service: string, severity: string, summary: string) {
  const incident = {
    id: `INC-${String(incidents.length + 1).padStart(4, "0")}`,
    service,
    severity,
    summary,
    timeline: [`${new Date().toISOString()} opened: ${summary}`],
  };
  incidents.push(incident);
  return incident;
}

export function appendTimelineNote(incidentId: string, note: string) {
  const incident = incidents.find((item) => item.id === incidentId);
  if (!incident) return { error: "incident_not_found", incidentId };
  incident.timeline.push(`${new Date().toISOString()} ${note}`);
  return incident;
}
