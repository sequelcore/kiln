import type { ManagedAgentInvocationRecord, ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import {
  assertNoEnvironmentNameCollisions,
  validateEnvironmentName,
  validateEnvironmentValue,
} from "./environment-lease-manager.js";
import type { ManagedAgentEnvironmentVariables } from "./environment-lease-manager.js";

export function validateManagedEnvironment(environment: ManagedAgentEnvironmentVariables): ManagedAgentEnvironmentVariables {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment bindings must be a string map");
  }
  const validated = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(environment)) {
    validated[validateEnvironmentName(name)] = validateEnvironmentValue(value);
  }
  assertNoEnvironmentNameCollisions(Object.keys(validated));
  return validated;
}

export function mergeManagedEnvironment(
  existing: ManagedAgentEnvironmentVariables | undefined,
  incoming: ManagedAgentEnvironmentVariables,
): ManagedAgentEnvironmentVariables {
  if (existing === undefined) {
    return incoming;
  }
  const environment = Object.assign(Object.create(null), existing, incoming) as Record<string, string>;
  assertNoEnvironmentNameCollisions(Object.keys(environment));
  return environment;
}

export function assertEnvironmentLeaseUrisDoNotContainValues(
  previousLease: ManagedAgentResourceLeaseEvidence,
  candidateLease: ManagedAgentResourceLeaseEvidence,
  environment: ManagedAgentEnvironmentVariables,
): void {
  if (environmentLeaseUrisContainingValues(previousLease, candidateLease, environment).length > 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed environment lease URI must not contain environment binding values");
  }
}

export function environmentLeaseUrisContainingValues(
  previousLease: ManagedAgentResourceLeaseEvidence,
  candidateLease: ManagedAgentResourceLeaseEvidence,
  environment: ManagedAgentEnvironmentVariables,
): readonly string[] {
  const environmentValues = environmentValueFragments(environment);
  if (environmentValues.length === 0) {
    return [];
  }
  const previousUris = new Set([...previousLease.resourceUris, ...previousLease.diagnosticUris]);
  return [...candidateLease.resourceUris, ...candidateLease.diagnosticUris]
    .filter((uri) => !previousUris.has(uri) && uriContainsEnvironmentValue(uri, environmentValues));
}

export function sanitizeEnvironmentLeaseEvidence(
  lease: ManagedAgentResourceLeaseEvidence,
  rejectedUris: readonly string[] | undefined,
): ManagedAgentResourceLeaseEvidence {
  if (rejectedUris === undefined || rejectedUris.length === 0) {
    return lease;
  }
  const rejectedUriSet = new Set(rejectedUris);
  return {
    ...lease,
    resourceUris: lease.resourceUris.filter((uri) => !rejectedUriSet.has(uri)),
    diagnosticUris: lease.diagnosticUris.filter((uri) => !rejectedUriSet.has(uri)),
  };
}

export function sanitizeEnvironmentDiagnostics(
  diagnostics: readonly NonNullable<ManagedAgentInvocationRecord["diagnostics"]>[number][],
  rejectedUris: readonly string[] | undefined,
): readonly NonNullable<ManagedAgentInvocationRecord["diagnostics"]>[number][] {
  if (rejectedUris === undefined || rejectedUris.length === 0) {
    return diagnostics;
  }
  const rejectedUriSet = new Set(rejectedUris);
  return diagnostics.filter((diagnostic) => !rejectedUriSet.has(diagnostic.uri));
}

function environmentValueFragments(environment: ManagedAgentEnvironmentVariables): readonly string[] {
  return Object.values(environment).filter((value) => value.length > 0);
}

function uriContainsEnvironmentValue(uri: string, environmentValues: readonly string[]): boolean {
  return environmentValues.some((value) => uri.includes(value) || uri.includes(encodeURIComponent(value)));
}
