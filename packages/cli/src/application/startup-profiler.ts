export interface StartupProfiler {
  mark(phase: string, detail?: Record<string, unknown>): void;
}

export function createStartupProfiler(surface: string, enabled = process.env.KILN_STARTUP_PROFILE === "1"): StartupProfiler {
  const startedAt = performance.now();
  return {
    mark(phase, detail) {
      if (!enabled) {
        return;
      }
      const payload = {
        type: "kiln_startup_profile",
        surface,
        phase,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...(detail ? { detail: sanitizeDetail(detail) } : {}),
      };
      process.stderr.write(`KILN_STARTUP_PROFILE ${JSON.stringify(payload)}\n`);
    },
  };
}

function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "string" && key.toLowerCase().includes("path")) {
      sanitized[key] = redactPath(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function redactPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const leaf = parts.at(-1) ?? "workspace";
  return `<path:${leaf}>`;
}
