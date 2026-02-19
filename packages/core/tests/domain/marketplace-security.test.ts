import { describe, it, expect } from "vitest";
import { applyDefaultAnnotations } from "../../src/domain/marketplace.js";
import type { CapabilityAnnotations } from "../../src/engine/domain/capability.js";

describe("applyDefaultAnnotations", () => {
  it("returns destructive defaults when no annotations provided", () => {
    const result = applyDefaultAnnotations();
    expect(result.destructive).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.idempotent).toBe(false);
  });

  it("returns destructive defaults for null annotations", () => {
    const result = applyDefaultAnnotations(null);
    expect(result.destructive).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.idempotent).toBe(false);
  });

  it("returns destructive defaults for undefined annotations", () => {
    const result = applyDefaultAnnotations(undefined);
    expect(result.destructive).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.idempotent).toBe(false);
  });

  it("preserves explicit destructive: true", () => {
    const annotations: CapabilityAnnotations = { destructive: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.destructive).toBe(true);
  });

  it("preserves explicit destructive: false", () => {
    const annotations: CapabilityAnnotations = { destructive: false };
    const result = applyDefaultAnnotations(annotations);
    expect(result.destructive).toBe(false);
  });

  it("preserves explicit readOnly: true", () => {
    const annotations: CapabilityAnnotations = { readOnly: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.readOnly).toBe(true);
  });

  it("preserves explicit readOnly: false", () => {
    const annotations: CapabilityAnnotations = { readOnly: false };
    const result = applyDefaultAnnotations(annotations);
    expect(result.readOnly).toBe(false);
  });

  it("preserves explicit idempotent: true", () => {
    const annotations: CapabilityAnnotations = { idempotent: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.idempotent).toBe(true);
  });

  it("preserves explicit idempotent: false", () => {
    const annotations: CapabilityAnnotations = { idempotent: false };
    const result = applyDefaultAnnotations(annotations);
    expect(result.idempotent).toBe(false);
  });

  it("defaults missing destructive to true", () => {
    const annotations: CapabilityAnnotations = { readOnly: true, idempotent: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.destructive).toBe(true);
  });

  it("defaults missing readOnly to false", () => {
    const annotations: CapabilityAnnotations = { destructive: false, idempotent: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.readOnly).toBe(false);
  });

  it("defaults missing idempotent to false", () => {
    const annotations: CapabilityAnnotations = { destructive: false, readOnly: true };
    const result = applyDefaultAnnotations(annotations);
    expect(result.idempotent).toBe(false);
  });

  it("preserves all explicit values", () => {
    const annotations: CapabilityAnnotations = {
      destructive: false,
      readOnly: true,
      idempotent: true,
    };
    const result = applyDefaultAnnotations(annotations);
    expect(result.destructive).toBe(false);
    expect(result.readOnly).toBe(true);
    expect(result.idempotent).toBe(true);
  });

  it("applies safe-by-default policy (unannotated = destructive)", () => {
    // This is the key security property: unknown tools are treated as destructive
    const result = applyDefaultAnnotations({});
    expect(result.destructive).toBe(true);
    expect(result.readOnly).toBe(false);
    expect(result.idempotent).toBe(false);
  });
});
