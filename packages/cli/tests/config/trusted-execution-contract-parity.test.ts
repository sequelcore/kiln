import {
  TRUSTED_EXECUTION_CLASSIFICATIONS as CORE_CLASSIFICATIONS,
  TRUSTED_EXECUTION_EVIDENCE_FRESHNESS as CORE_FRESHNESS,
  TRUSTED_EXECUTION_EVIDENCE_SOURCES as CORE_EVIDENCE_SOURCES,
  TRUSTED_EXECUTION_PROFILES as CORE_PROFILES,
  TRUSTED_EXECUTION_PROOF_STATUSES as CORE_PROOF_STATUSES,
} from "@kilnai/core";
import {
  TRUSTED_EXECUTION_CLASSIFICATIONS as GATEWAY_CLASSIFICATIONS,
  TRUSTED_EXECUTION_EVIDENCE_FRESHNESS as GATEWAY_FRESHNESS,
  TRUSTED_EXECUTION_EVIDENCE_SOURCES as GATEWAY_EVIDENCE_SOURCES,
  TRUSTED_EXECUTION_PROFILES as GATEWAY_PROFILES,
  TRUSTED_EXECUTION_PROOF_STATUSES as GATEWAY_PROOF_STATUSES,
} from "@kilnai/gateway-contracts";
import { describe, expect, it } from "vitest";

describe("trusted execution contract parity", () => {
  it.each([
    ["profiles", CORE_PROFILES, GATEWAY_PROFILES],
    ["classifications", CORE_CLASSIFICATIONS, GATEWAY_CLASSIFICATIONS],
    ["proof statuses", CORE_PROOF_STATUSES, GATEWAY_PROOF_STATUSES],
    ["freshness statuses", CORE_FRESHNESS, GATEWAY_FRESHNESS],
    ["evidence sources", CORE_EVIDENCE_SOURCES, GATEWAY_EVIDENCE_SOURCES],
  ] as const)("keeps Core and Gateway %s mechanically aligned", (_label, core, gateway) => {
    expect(core).toBeDefined();
    expect(gateway).toBeDefined();
    expect(core).toEqual(gateway);
  });

  it("keeps Core evidence sources finite and explicit", () => {
    expect(CORE_EVIDENCE_SOURCES).toEqual([
      "operator-local-config",
      "repository-config",
      "native-config",
      "desktop-ui-selection",
      "session-metadata",
      "runtime-observation",
      "managed-child-observation",
    ]);
  });
});
