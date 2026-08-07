import type { GuiAuthorityStatus } from "@kilnai/gateway-contracts";
import { isObjectRecord, readNumber, readString } from "./unknown-value.js";

/**
 * Parses the runtime-projected authority-status envelope out of event/frame
 * payloads. Pure, no store dependency.
 */

export type AuthorityStatus = GuiAuthorityStatus;

export function readAuthorityStatus(value: unknown): AuthorityStatus | null {
  const record = isObjectRecord(value) ? value : null;
  if (!record) {
    return null;
  }
  const effective = record.effective;
  const completeness = record.completeness;
  if (
    (
      effective === "fail_closed"
      || effective === "read_only"
      || effective === "idempotent"
      || effective === "audited"
      || effective === "destructive"
      || effective === "unknown"
    )
    && (completeness === "authoritative" || completeness === "partial")
  ) {
    const admittedAuthority = record.admittedAuthority;
    const requestedAuthority = record.requestedAuthority;
    const executionMode = record.executionMode;
    const sandboxProjection = record.sandboxProjection;
    const reason = readString(record.reason);
    const toolCount = readNumber(record.toolCount);
    const deniedToolCount = readNumber(record.deniedToolCount);
    return {
      effective,
      ...(admittedAuthority === "fail_closed"
        || admittedAuthority === "read_only"
        || admittedAuthority === "idempotent"
        || admittedAuthority === "audited"
        || admittedAuthority === "destructive"
        || admittedAuthority === "unknown"
        ? { admittedAuthority }
        : {}),
      ...(requestedAuthority === "planning"
        || requestedAuthority === "auto"
        || requestedAuthority === "read_only"
        || requestedAuthority === "audited"
        || requestedAuthority === "destructive"
        ? { requestedAuthority }
        : {}),
      ...(executionMode === "execute" || executionMode === "plan" ? { executionMode } : {}),
      ...(sandboxProjection === "none"
        || sandboxProjection === "read_only"
        || sandboxProjection === "workspace_write"
        || sandboxProjection === "unknown"
        ? { sandboxProjection }
        : {}),
      ...(reason ? { reason } : {}),
      ...(typeof toolCount === "number" ? { toolCount } : {}),
      ...(typeof deniedToolCount === "number" ? { deniedToolCount } : {}),
      completeness,
    };
  }
  return null;
}
