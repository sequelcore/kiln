import { describe, it, expect, vi } from "vitest";
import { HealthRegistry } from "../../src/gateway/health-registry.js";

describe("HealthRegistry", () => {
  describe("registration", () => {
    it("should register a health checker", async () => {
      const registry = new HealthRegistry();
      const checker = () => ({ status: "ok" as const });

      registry.register("test", checker);

      const results = await registry.checkAll();
      expect(results.test).toEqual({ status: "ok" });
    });

    it("should register multiple health checkers", async () => {
      const registry = new HealthRegistry();

      registry.register("memory", () => ({ status: "ok" as const }));
      registry.register("database", () => ({ status: "ok" as const }));

      const results = await registry.checkAll();
      expect(Object.keys(results)).toHaveLength(2);
      expect(results.memory).toEqual({ status: "ok" });
      expect(results.database).toEqual({ status: "ok" });
    });

  });

  describe("checkAll", () => {
    it("should return empty object when no checkers registered", async () => {
      const registry = new HealthRegistry();
      const results = await registry.checkAll();
      expect(results).toEqual({});
    });

    it("should call all registered checkers", async () => {
      const registry = new HealthRegistry();
      const checker1 = vi.fn().mockReturnValue({ status: "ok" });
      const checker2 = vi.fn().mockReturnValue({ status: "ok" });

      registry.register("checker1", checker1);
      registry.register("checker2", checker2);

      await registry.checkAll();

      expect(checker1).toHaveBeenCalledTimes(1);
      expect(checker2).toHaveBeenCalledTimes(1);
    });

    it("should support async checkers", async () => {
      const registry = new HealthRegistry();

      registry.register("async", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: "ok" as const };
      });

      const results = await registry.checkAll();
      expect(results.async).toEqual({ status: "ok" });
    });

    it("should handle checker errors gracefully", async () => {
      const registry = new HealthRegistry();

      registry.register("failing", () => {
        throw new Error("Checker failed");
      });

      const results = await registry.checkAll();

      expect(results.failing).toEqual({
        status: "error",
        details: { error: "Checker failed" },
      });
    });

    it("should include checker details in results", async () => {
      const registry = new HealthRegistry();

      registry.register("with-details", () => ({
        status: "ok" as const,
        details: { version: "1.0.0", connections: 5 },
      }));

      const results = await registry.checkAll();
      expect(results["with-details"]).toEqual({
        status: "ok",
        details: { version: "1.0.0", connections: 5 },
      });
    });

    it("should handle multiple statuses", async () => {
      const registry = new HealthRegistry();

      registry.register("ok", () => ({ status: "ok" as const }));
      registry.register("degraded", () => ({ status: "degraded" as const }));
      registry.register("error", () => ({ status: "error" as const }));

      const results = await registry.checkAll();

      expect(results.ok!.status).toBe("ok");
      expect(results.degraded!.status).toBe("degraded");
      expect(results.error!.status).toBe("error");
    });
  });

  describe("aggregateStatus", () => {
    it("should return ok when all subsystems are ok", () => {
      const subsystems = {
        memory: { status: "ok" as const },
        database: { status: "ok" as const },
      };

      const status = HealthRegistry.aggregateStatus(subsystems);
      expect(status).toBe("ok");
    });

    it("should return degraded when one subsystem is degraded", () => {
      const subsystems = {
        memory: { status: "ok" as const },
        database: { status: "degraded" as const },
      };

      const status = HealthRegistry.aggregateStatus(subsystems);
      expect(status).toBe("degraded");
    });

    it("should return error when one subsystem has error", () => {
      const subsystems = {
        memory: { status: "ok" as const },
        database: { status: "error" as const },
      };

      const status = HealthRegistry.aggregateStatus(subsystems);
      expect(status).toBe("error");
    });

    it("should prioritize error over degraded", () => {
      const subsystems = {
        memory: { status: "degraded" as const },
        database: { status: "error" as const },
      };

      const status = HealthRegistry.aggregateStatus(subsystems);
      expect(status).toBe("error");
    });

    it("should return ok for empty subsystems", () => {
      const subsystems = {};
      const status = HealthRegistry.aggregateStatus(subsystems);
      expect(status).toBe("ok");
    });
  });
});
