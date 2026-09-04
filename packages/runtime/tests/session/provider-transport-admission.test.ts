import { describe, expect, it } from "vitest";
import {
  RuntimeProviderTransportBudgetAuthority,
  RuntimeProviderTransportBudgetExceededError,
} from "../../src/session/provider-transport-admission.js";

describe("RuntimeProviderTransportBudgetAuthority", () => {
  it("shares one hard physical-attempt fence across callers", () => {
    const authority = new RuntimeProviderTransportBudgetAuthority(2);

    authority.admit({ requestId: "parent:1" });
    authority.admit({ requestId: "child:1" });

    expect(authority.snapshot()).toEqual({ admitted: 2, limit: 2, remaining: 0 });
    expect(() => authority.admit({ requestId: "parent:retry" }))
      .toThrow(RuntimeProviderTransportBudgetExceededError);
    expect(authority.snapshot()).toEqual({ admitted: 2, limit: 2, remaining: 0 });
  });

  it("rejects non-positive or non-integral limits", () => {
    expect(() => new RuntimeProviderTransportBudgetAuthority(0)).toThrow("positive safe integer");
    expect(() => new RuntimeProviderTransportBudgetAuthority(1.5)).toThrow("positive safe integer");
  });
});
