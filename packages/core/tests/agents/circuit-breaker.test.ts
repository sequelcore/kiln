import { describe, it, expect, beforeEach, vi } from "vitest";
import { CircuitBreaker } from "../../src/agents/circuit-breaker.js";
import { KilnError } from "../../src/engine/errors.js";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    // Reset any lingering timers
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("should start in closed state", () => {
      const cb = new CircuitBreaker();
      expect(cb.currentState).toBe("closed");
    });

    it("should use default config when not provided", () => {
      const cb = new CircuitBreaker();
      expect(cb.currentState).toBe("closed");
    });

    it("should accept custom config", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxAttempts: 2,
      });
      expect(cb.currentState).toBe("closed");
    });
  });

  describe("closed state", () => {
    it("should execute successful function", async () => {
      const cb = new CircuitBreaker();
      const fn = vi.fn().mockResolvedValue("success");

      const result = await cb.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should propagate function errors", async () => {
      const cb = new CircuitBreaker();
      const error = new Error("Function failed");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(cb.execute(fn)).rejects.toBe(error);
    });

    it("should track consecutive failures", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      // First 2 failures should not open circuit
      await expect(cb.execute(fn)).rejects.toThrow();
      await expect(cb.execute(fn)).rejects.toThrow();

      expect(cb.currentState).toBe("closed");

      // 3rd failure should open circuit
      await expect(cb.execute(fn)).rejects.toThrow();
      expect(cb.currentState).toBe("open");
    });

    it("should reset failure count on success", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const successFn = vi.fn().mockResolvedValue("success");

      // 2 failures
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();

      // 1 success should reset
      await cb.execute(successFn);

      // 2 more failures should not open (counter reset)
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();

      expect(cb.currentState).toBe("closed");
    });
  });

  describe("open state", () => {
    it("should throw CIRCUIT_OPEN error", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      // Open the circuit
      await expect(cb.execute(fn)).rejects.toThrow();
      expect(cb.currentState).toBe("open");

      // Next call should throw CIRCUIT_OPEN
      try {
        await cb.execute(fn);
        expect.fail("Should have thrown");
      } catch (error) {
        // Check error properties instead of instanceof (module identity issue)
        expect((error as Error).name).toBe("KilnError");
        expect((error as KilnError).code).toBe("CIRCUIT_OPEN");
        expect((error as KilnError).retryable).toBe(true);
      }
    });

    it("should not call function when circuit is open", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      // Open the circuit
      await expect(cb.execute(fn)).rejects.toThrow();

      // Reset mock to track new calls
      fn.mockClear();

      // Should throw without calling fn
      await expect(cb.execute(fn)).rejects.toThrow();
      expect(fn).not.toHaveBeenCalled();
    });

    it("should include context in CIRCUIT_OPEN error", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      await expect(cb.execute(fn)).rejects.toThrow();

      try {
        await cb.execute(fn);
      } catch (error) {
        const kilnError = error as KilnError;
        expect(kilnError.context.state).toBe("open");
        expect(kilnError.context.resetTimeoutMs).toBe(30000);
        expect(kilnError.context.lastFailureTime).toBeDefined();
      }
    });
  });

  describe("half-open state", () => {
    it("should transition to half-open after timeout", async () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
      });
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      // Open the circuit
      await expect(cb.execute(fn)).rejects.toThrow();
      expect(cb.currentState).toBe("open");

      // Advance time past reset timeout
      vi.advanceTimersByTime(1001);

      // Next call should transition to half-open (test probe)
      fn.mockRejectedValueOnce(new Error("fail"));
      await expect(cb.execute(fn)).rejects.toThrow();
      expect(cb.currentState).toBe("open"); // Failed probe goes back to open

      vi.useRealTimers();
    });

    it("should close circuit after successful half-open probe", async () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxAttempts: 1,
      });

      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

      // Advance time past reset timeout
      vi.advanceTimersByTime(1001);

      // Successful probe should close circuit
      await cb.execute(() => Promise.resolve("success"));
      expect(cb.currentState).toBe("closed");

      vi.useRealTimers();
    });

    it("should require multiple successes to close when configured", async () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxAttempts: 3,
      });

      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

      // Advance time past reset timeout
      vi.advanceTimersByTime(1001);

      // First 2 successes should stay in half-open
      await cb.execute(() => Promise.resolve("success"));
      expect(cb.currentState).toBe("half-open");

      await cb.execute(() => Promise.resolve("success"));
      expect(cb.currentState).toBe("half-open");

      // 3rd success should close
      await cb.execute(() => Promise.resolve("success"));
      expect(cb.currentState).toBe("closed");

      vi.useRealTimers();
    });
  });

  describe("reset", () => {
    it("should reset circuit to closed state", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });

      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      expect(cb.currentState).toBe("open");

      // Reset
      cb.reset();

      expect(cb.currentState).toBe("closed");

      // Should work normally after reset
      const result = await cb.execute(() => Promise.resolve("success"));
      expect(result).toBe("success");
    });

    it("should reset failure count", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      // 4 failures
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

      // Reset
      cb.reset();

      // 4 more failures should not open (threshold is 5, counter was reset)
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

      expect(cb.currentState).toBe("closed");
    });
  });
});
