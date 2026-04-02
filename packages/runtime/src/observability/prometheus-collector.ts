import type { EventStore, KilnEvent } from "@kilnai/core";

const SECURITY_ALERT_CATEGORY_ALLOWLIST = new Set<string>([
  "indirect_injection",
  "injection",
]);
const POLICY_RAIL_TYPE_ALLOWLIST = new Set<string>([
  "topic",
  "competitor",
  "escalation",
  "compliance",
]);

/** Prometheus registry handle (prom-client type) */
interface PromRegistry {
  metrics(): Promise<string>;
  contentType: string;
}

/** PrometheusCollector configuration */
export interface PrometheusCollectorConfig {
  readonly prefix?: string; // metric name prefix, default "kiln"
}

/**
 * EventStore implementation that updates Prometheus counters and histograms.
 * Requires `prom-client` as an optional peer dependency.
 * Write-only: getBySession/getAfter are not supported.
 */
export class PrometheusCollector implements EventStore {
  private registry: PromRegistry | null = null;
  private counters: Record<
    string,
    { inc(labels: Record<string, string>, value?: number): void }
  > = {};
  private histograms: Record<
    string,
    { observe(labels: Record<string, string>, value: number): void }
  > = {};
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly config: PrometheusCollectorConfig = {}) {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const prom = await import("prom-client");
      const prefix = this.config.prefix ?? "kiln";
      const registry = new prom.Registry();

      // Counters
      this.counters.llm_requests = new prom.Counter({
        name: `${prefix}_llm_requests_total`,
        help: "Total LLM requests",
        labelNames: ["provider", "model", "status"],
        registers: [registry],
      });

      this.counters.llm_tokens = new prom.Counter({
        name: `${prefix}_llm_tokens_total`,
        help: "Total LLM tokens",
        labelNames: ["direction", "provider", "model"],
        registers: [registry],
      });

      this.counters.cost_usd = new prom.Counter({
        name: `${prefix}_cost_usd_total`,
        help: "Total cost in USD",
        labelNames: ["provider", "model"],
        registers: [registry],
      });

      this.counters.tool_calls = new prom.Counter({
        name: `${prefix}_tool_calls_total`,
        help: "Total tool calls",
        labelNames: ["tool_name", "success"],
        registers: [registry],
      });

      this.counters.tool_cache_hits = new prom.Counter({
        name: `${prefix}_tool_cache_hits_total`,
        help: "Total tool cache hits",
        labelNames: ["tool_name"],
        registers: [registry],
      });

      this.counters.errors = new prom.Counter({
        name: `${prefix}_errors_total`,
        help: "Total errors",
        labelNames: ["code"],
        registers: [registry],
      });

      this.counters.agent_routings = new prom.Counter({
        name: `${prefix}_agent_routings_total`,
        help: "Total agent routing decisions",
        labelNames: ["agent_name", "routing_tier"],
        registers: [registry],
      });

      this.counters.model_routings = new prom.Counter({
        name: `${prefix}_model_routings_total`,
        help: "Total model routing decisions",
        labelNames: ["provider", "model", "routing_tier"],
        registers: [registry],
      });

      this.counters.security_alerts = new prom.Counter({
        name: `${prefix}_security_alerts_total`,
        help: "Total security alerts",
        labelNames: ["severity", "category"],
        registers: [registry],
      });

      this.counters.policy_evaluations = new prom.Counter({
        name: `${prefix}_policy_evaluations_total`,
        help: "Total policy evaluations",
        labelNames: ["rail_type", "allowed", "direction"],
        registers: [registry],
      });

      // Histograms
      this.histograms.llm_duration = new prom.Histogram({
        name: `${prefix}_llm_request_duration_seconds`,
        help: "LLM request duration in seconds",
        labelNames: ["provider", "model"],
        buckets: [0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0],
        registers: [registry],
      });

      this.registry = registry as unknown as PromRegistry;
      this.initialized = true;
    } catch {
      console.warn(
        "[prometheus] prom-client not available, metrics disabled",
      );
      this.initialized = false;
    }
  }

  /** Get the Prometheus registry for the /metrics endpoint */
  async getRegistry(): Promise<PromRegistry | null> {
    if (this.initPromise) await this.initPromise;
    return this.registry;
  }

  async save(event: KilnEvent): Promise<void> {
    if (!this.initialized) return;

    switch (event.type) {
      case "cost_update": {
        const e = event as KilnEvent & {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          totalCostUsd: number;
          byRoleModel: Record<
            string,
            { model: string; calls: number; costUsd: number }
          >;
        };
        for (const [, role] of Object.entries(e.byRoleModel)) {
          const model = role.model;
          const provider = this.inferProvider(model);
          this.counters.llm_requests?.inc({
            provider,
            model,
            status: "success",
          });
          this.counters.cost_usd?.inc({ provider, model }, role.costUsd);
        }
        this.counters.llm_tokens?.inc(
          { direction: "input", provider: "", model: "" },
          e.inputTokens,
        );
        this.counters.llm_tokens?.inc(
          { direction: "output", provider: "", model: "" },
          e.outputTokens,
        );
        break;
      }
      case "tool_result": {
        const e = event as KilnEvent & {
          toolName: string;
          success: boolean;
          durationMs: number;
        };
        this.counters.tool_calls?.inc({
          tool_name: e.toolName,
          success: String(e.success),
        });
        break;
      }
      case "tool_cache_hit": {
        const e = event as KilnEvent & { toolName: string };
        this.counters.tool_cache_hits?.inc({ tool_name: e.toolName });
        break;
      }
      case "error": {
        const e = event as KilnEvent & { code: string };
        this.counters.errors?.inc({ code: e.code });
        break;
      }
      case "agent_routed": {
        const e = event as KilnEvent & {
          agentName: string;
          routingTier: string;
        };
        this.counters.agent_routings?.inc({
          agent_name: e.agentName,
          routing_tier: e.routingTier,
        });
        break;
      }
      case "model_routed": {
        const e = event as KilnEvent & {
          model: string;
          provider: string;
          routingTier: string;
        };
        this.counters.model_routings?.inc({
          provider: e.provider,
          model: e.model,
          routing_tier: e.routingTier,
        });
        break;
      }
      case "security_alert": {
        const e = event as KilnEvent & {
          severity?: string;
          category?: string;
        };
        this.counters.security_alerts?.inc({
          severity: this.resolveSecuritySeverityLabel(e.severity),
          category: this.resolveSecurityCategoryLabel(e.category),
        });
        break;
      }
      case "policy_evaluated": {
        const e = event as KilnEvent & {
          railType?: string;
          allowed?: boolean;
          direction?: string;
        };
        this.counters.policy_evaluations?.inc({
          rail_type: this.resolvePolicyRailTypeLabel(e.railType),
          allowed: this.resolvePolicyAllowedLabel(e.allowed),
          direction: this.resolvePolicyDirectionLabel(e.direction),
        });
        break;
      }
      // Other event types: no metrics to collect
    }
  }

  async getBySession(_sessionId: string): Promise<KilnEvent[]> {
    throw new Error("PrometheusCollector is write-only");
  }

  async getAfter(_sessionId: string, _afterId: string): Promise<KilnEvent[]> {
    throw new Error("PrometheusCollector is write-only");
  }

  private inferProvider(model: string): string {
    if (model.startsWith("claude")) return "anthropic";
    if (
      model.startsWith("gpt") ||
      model.startsWith("o1") ||
      model.startsWith("o3")
    )
      return "openai";
    if (model.startsWith("deepseek")) return "deepseek";
    return "ollama";
  }

  private resolveSecuritySeverityLabel(severity: unknown): string {
    if (
      severity === "low" ||
      severity === "medium" ||
      severity === "high" ||
      severity === "critical"
    ) {
      return severity;
    }
    return "unknown";
  }

  private resolveSecurityCategoryLabel(category: unknown): string {
    if (typeof category !== "string") return "unknown";
    const normalized = category.trim().toLowerCase();
    if (normalized.length === 0) return "unknown";
    return SECURITY_ALERT_CATEGORY_ALLOWLIST.has(normalized)
      ? normalized
      : "unknown";
  }

  private resolvePolicyRailTypeLabel(railType: unknown): string {
    if (typeof railType !== "string") return "unknown";
    const normalized = railType.trim().toLowerCase();
    if (normalized.length === 0) return "unknown";
    return POLICY_RAIL_TYPE_ALLOWLIST.has(normalized) ? normalized : "unknown";
  }

  private resolvePolicyAllowedLabel(allowed: unknown): string {
    if (allowed === true) return "true";
    if (allowed === false) return "false";
    return "unknown";
  }

  private resolvePolicyDirectionLabel(direction: unknown): string {
    if (direction === "input" || direction === "output") return direction;
    return "unknown";
  }
}
