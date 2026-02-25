export type SubsystemStatus = "ok" | "degraded" | "error";

export interface SubsystemHealth {
  readonly status: SubsystemStatus;
  readonly details?: Record<string, unknown>;
}

export type HealthChecker = () => SubsystemHealth | Promise<SubsystemHealth>;

/**
 * Registry for subsystem health checkers.
 * Used by the /health endpoint to aggregate subsystem status.
 */
export class HealthRegistry {
  private readonly checkers = new Map<string, HealthChecker>();

  register(name: string, checker: HealthChecker): void {
    this.checkers.set(name, checker);
  }

  async checkAll(): Promise<Record<string, SubsystemHealth>> {
    const results: Record<string, SubsystemHealth> = {};

    for (const [name, checker] of this.checkers) {
      try {
        results[name] = await checker();
      } catch (error) {
        results[name] = {
          status: "error",
          details: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    }

    return results;
  }

  /** Aggregate overall status from subsystem results */
  static aggregateStatus(subsystems: Record<string, SubsystemHealth>): SubsystemStatus {
    const statuses = Object.values(subsystems).map((s) => s.status);

    if (statuses.length === 0) {
      return "ok";
    }

    if (statuses.includes("error")) {
      return "error";
    }

    if (statuses.includes("degraded")) {
      return "degraded";
    }

    return "ok";
  }
}
