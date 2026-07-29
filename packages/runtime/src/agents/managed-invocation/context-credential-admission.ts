import { defineManagedAgentInvocationRequest } from "@kilnai/core";
import type {
  ContextAuditEntry,
  ManagedAgentCredentialRoute,
  ManagedAgentInvocationRequest,
  ManagedAgentMemoryScope,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";

export interface ManagedChildGovernedContext {
  readonly content: string;
  readonly audit?: ContextAuditEntry;
}

export interface ManagedChildCredentialRouteInput {
  readonly routeId?: string;
  readonly secretValues?: readonly string[];
}

export interface ManagedChildExplicitAuthority {
  readonly memoryScope?: ManagedAgentMemoryScope;
  readonly writeAllowed?: boolean;
}

export interface ManagedChildParentAuthoritySnapshot {
  readonly memoryScope?: ManagedAgentMemoryScope;
  readonly writeAllowed?: boolean;
}

export interface ManagedChildContextCredentialAdmissionInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly governedContext: ManagedChildGovernedContext;
  readonly credentialRoute?: ManagedChildCredentialRouteInput;
  readonly explicitAuthority: ManagedChildExplicitAuthority;
  readonly parentAuthoritySnapshot?: ManagedChildParentAuthoritySnapshot;
}

export interface ManagedChildContextCredentialEvidence {
  readonly context: {
    readonly governor: "DefaultContextGovernor";
    readonly selectedBlockIds: readonly string[];
    readonly deferredBlockIds: readonly string[];
    readonly requiredBlockIds: readonly string[];
    readonly preservedRequiredBlockIds: readonly string[];
    readonly selectedTokens: number;
    readonly requiredTokens: number;
    readonly tokenBudget: number;
    readonly overflow: boolean;
    readonly overflowReason?: "budget-cap" | "required-overflow";
  };
  readonly credentialRouteId?: string;
}

export interface ManagedChildContextCredentialAdmissionResult {
  readonly childRequest: ManagedAgentInvocationRequest;
  readonly evidence: ManagedChildContextCredentialEvidence;
}

export function admitManagedChildContextAndCredentials(
  input: ManagedChildContextCredentialAdmissionInput,
): ManagedChildContextCredentialAdmissionResult {
  const audit = input.governedContext.audit;
  if (audit?.governor !== "DefaultContextGovernor") {
    throw new ManagedAgentRuntimeAdmissionError("Managed child invocation context must include a DefaultContextGovernor audit");
  }

  const memoryScope = input.explicitAuthority.memoryScope;
  if (!memoryScope) {
    throw new ManagedAgentRuntimeAdmissionError("Managed child invocation requires explicit memory scope authority");
  }

  const writeAllowed = input.explicitAuthority.writeAllowed;
  if (typeof writeAllowed !== "boolean") {
    throw new ManagedAgentRuntimeAdmissionError("Managed child invocation requires explicit write authority");
  }

  const { credentialRoute, credentialRouteId } = resolveCredentialRoute(
    input.request.authority.credentialRoute,
    input.credentialRoute,
  );

  const childRequest = defineManagedAgentInvocationRequest({
    ...input.request,
    authority: {
      ...input.request.authority,
      toolAuthority: {
        ...input.request.authority.toolAuthority,
        writeAllowed,
      },
      memoryScope,
      credentialRoute,
    },
    input: {
      ...input.request.input,
      prompt: appendGovernedContext(input.request.input.prompt, input.governedContext.content),
    },
  });

  return {
    childRequest,
    evidence: {
      context: {
        governor: audit.governor,
        selectedBlockIds: audit.selectedBlockIds,
        deferredBlockIds: audit.deferredBlockIds,
        requiredBlockIds: audit.requiredBlockIds,
        preservedRequiredBlockIds: audit.preservedRequiredBlockIds,
        selectedTokens: audit.selectedTokens,
        requiredTokens: audit.requiredTokens,
        tokenBudget: audit.tokenBudget,
        overflow: audit.overflow,
        ...(audit.overflowReason !== undefined ? { overflowReason: audit.overflowReason } : {}),
      },
      ...(credentialRouteId !== undefined ? { credentialRouteId } : {}),
    },
  };
}

function appendGovernedContext(prompt: string | undefined, contextContent: string): string {
  const normalizedContext = contextContent.trim();
  if (normalizedContext.length === 0) {
    return prompt?.trim() ?? "";
  }

  const normalizedPrompt = prompt?.trim() ?? "";
  if (normalizedPrompt.length === 0) {
    return `--- Governed Context ---\n${normalizedContext}`;
  }

  return `${normalizedPrompt}\n\n--- Governed Context ---\n${normalizedContext}`;
}

function resolveCredentialRoute(
  requestRoute: ManagedAgentCredentialRoute,
  credentialRouteInput: ManagedChildCredentialRouteInput | undefined,
): {
  readonly credentialRoute: ManagedAgentCredentialRoute;
  readonly credentialRouteId?: string;
} {
  if (requestRoute.mode === "credentialless") {
    return { credentialRoute: requestRoute };
  }

  const routeId = (credentialRouteInput?.routeId ?? requestRoute.routeId).trim();
  if (routeId.length === 0) {
    throw new ManagedAgentRuntimeAdmissionError("Managed child invocation requires an explicit credential route id");
  }

  return {
    credentialRoute: requestRoute.mode === "account-leased"
      ? {
        mode: "account-leased",
        routeId,
        accountPolicyId: requestRoute.accountPolicyId,
      }
      : {
        mode: "runtime-selected",
        routeId,
      },
    credentialRouteId: routeId,
  };
}
