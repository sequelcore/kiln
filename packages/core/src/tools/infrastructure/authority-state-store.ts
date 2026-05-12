import type { ToolResourceChangeNotifier } from "../domain/tool-resource-notifications.js";

export type EffectiveTurnAuthorityLevel =
  | "fail_closed"
  | "read_only"
  | "idempotent"
  | "audited"
  | "destructive"
  | "unknown";

export type EffectiveTurnAuthorityCompleteness = "authoritative" | "partial";

export type EffectiveTurnAuthoritySourcePolicy =
  | "provider_profile_gate"
  | "runtime_surface_projection"
  | "plan_mode_projection";

export type EffectiveTurnAuthoritySandboxProjection =
  | "none"
  | "read_only"
  | "workspace_write"
  | "unknown";

export type EffectiveTurnAuthorityPolicyInputSource =
  | "requested_authority"
  | "session_policy"
  | "tenant_policy"
  | "route_policy"
  | "parent_authority"
  | "plan_approval"
  | "goal_envelope"
  | "work_item_authority";

export type EffectiveTurnAuthorityPolicyInputStatus =
  | "applied"
  | "not_applicable"
  | "unresolved";

export interface EffectiveTurnAuthorityPolicyInput {
  readonly source: EffectiveTurnAuthorityPolicyInputSource;
  readonly status: EffectiveTurnAuthorityPolicyInputStatus;
  readonly reason: string;
  readonly subjectId?: string;
  readonly requestedAuthority?: "planning" | "auto" | "read_only" | "audited" | "destructive";
  readonly admittedAuthority?: EffectiveTurnAuthorityLevel;
}

export interface EffectiveTurnAuthoritySnapshot {
  readonly executionMode: "execute" | "plan";
  readonly requestedAuthority: "planning" | "auto" | "read_only" | "audited" | "destructive";
  readonly admittedAuthority: EffectiveTurnAuthorityLevel;
  readonly sourcePolicy: EffectiveTurnAuthoritySourcePolicy;
  readonly reason: string;
  readonly completeness: EffectiveTurnAuthorityCompleteness;
  readonly toolCount: number;
  readonly deniedToolCount: number;
  readonly sandboxProjection?: EffectiveTurnAuthoritySandboxProjection;
  readonly policyInputs?: readonly EffectiveTurnAuthorityPolicyInput[];
}

export interface AuthorityStateRecord {
  readonly id: string;
  readonly turnId?: string;
  readonly recordedAt: string;
  readonly source: "runtime" | "gui" | "tui" | "cli" | "sdk";
  readonly authority: EffectiveTurnAuthoritySnapshot;
  readonly sequence: number;
}

export interface AuthorityStateSnapshot {
  readonly authorities: readonly AuthorityStateRecord[];
  readonly latest?: AuthorityStateRecord;
  readonly sequence: number;
}

export interface AuthorityStateStoreOptions {
  readonly now?: () => string;
  readonly resourceNotifications?: ToolResourceChangeNotifier;
}

export interface AuthorityStateRecordInput {
  readonly turnId?: string;
  readonly source?: AuthorityStateRecord["source"];
  readonly authority: EffectiveTurnAuthoritySnapshot;
}

export class AuthorityStateStore {
  private readonly now: () => string;
  private resourceNotifications: ToolResourceChangeNotifier | undefined;
  private readonly authorities = new Map<string, AuthorityStateRecord>();
  private sequence = 0;

  constructor(options: AuthorityStateStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.resourceNotifications = options.resourceNotifications;
  }

  setResourceChangeNotifier(notifier: ToolResourceChangeNotifier): void {
    this.resourceNotifications = notifier;
  }

  record(input: AuthorityStateRecordInput): AuthorityStateRecord {
    this.sequence += 1;
    const record: AuthorityStateRecord = {
      id: `authority_${this.sequence}`,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      recordedAt: this.now(),
      source: input.source ?? "runtime",
      authority: input.authority,
      sequence: this.sequence,
    };
    this.authorities.set(record.id, record);
    this.notifyAuthorityResources(record.id);
    return record;
  }

  list(): readonly AuthorityStateRecord[] {
    return Array.from(this.authorities.values()).sort((left, right) => left.sequence - right.sequence);
  }

  get(id: string): AuthorityStateRecord | undefined {
    return this.authorities.get(id);
  }

  latest(): AuthorityStateRecord | undefined {
    return this.list().at(-1);
  }

  snapshot(): AuthorityStateSnapshot {
    const authorities = this.list();
    const latest = authorities.at(-1);
    return {
      authorities,
      ...(latest ? { latest } : {}),
      sequence: this.sequence,
    };
  }

  private notifyAuthorityResources(authorityId: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/authority");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/authority/${authorityId}`);
  }
}
