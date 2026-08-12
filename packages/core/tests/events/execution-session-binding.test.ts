import { describe, expect, it } from "vitest";
import { executionSessionBindingKey } from "../../src/events/execution-session-event.js";

describe("execution session binding identity", () => {
  it("uses one route/account/credential identity for bound and rejected evidence", () => {
    const bound = executionSessionBindingKey({
      status: "bound",
      routeId: "route-shared",
      accountId: "account-shared",
      credentialId: "credential-shared",
      credentialRevision: "revision-bound",
    });
    const rejected = executionSessionBindingKey({
      status: "rejected-pre-dispatch",
      routeId: "route-shared",
      accountId: "account-shared",
      credentialId: "credential-shared",
    });

    expect(bound).toBe(rejected);
    expect(bound).toBe("route-shared\0account-shared\0credential-shared");
  });

  it("keeps a rejected binding identifiable when dispatch identity is unavailable", () => {
    expect(executionSessionBindingKey({
      status: "rejected-pre-dispatch",
      routeId: "route-shared",
    })).toBe("route-shared\0\0");
  });
});
