// Observability: SpanMapper -- pure, stateless mapping from KilnEvent to SpanOperation descriptors.
// Zero external dependencies. Exhaustive switch with TypeScript never-guard.

import type {
    KilnEvent,
    PhaseChangedEvent,
    TaskStartedEvent,
    TaskCompletedEvent,
    ToolCalledEvent,
    ToolResultEvent,
    ThinkingEvent,
    VerificationResultEvent,
    CostUpdateEvent,
    MemorySavedEvent,
    MemoryRecalledEvent,
    MemorySyncEvent,
    ApprovalRequestedEvent,
    ApprovalReceivedEvent,
    WorkerAssignedEvent,
    ErrorEvent,
    TraceSpanEvent,
    HandoffRequestedEvent,
    HandoffCompletedEvent,
    InterruptRequestedEvent,
    InterruptResumedEvent,
    InjectionScannedEvent,
    GuardianReviewedEvent,
    AuditEntryEvent,
    TenantIsolationViolationEvent,
    SecurityAlertEvent,
    WebhookReceivedEvent,
    TriggerFiredEvent,
    TriggerFailedEvent,
    ScheduleFiredEvent,
    PiiDetectedEvent,
    ContentClassifiedEvent,
    PolicyEvaluatedEvent,
} from "../events/index.js";

// ---------------------------------------------------------------------------
// SpanOperation discriminated union
// ---------------------------------------------------------------------------

export type SpanOperation =
    | { action: "startSpan"; name: string; kind: string; attributes: Record<string, string | number | boolean> }
    | { action: "endSpan"; status: "ok" | "error"; attributes?: Record<string, string | number | boolean> }
    | { action: "addEvent"; name: string; attributes: Record<string, string | number | boolean> }
    | { action: "setAttributes"; attributes: Record<string, string | number | boolean> };

// ---------------------------------------------------------------------------
// Individual mappers (typed helpers to keep the switch concise)
// ---------------------------------------------------------------------------

function mapPhaseChanged(e: PhaseChangedEvent): SpanOperation {
    return {
        action: "startSpan",
        name: e.phaseName || e.phase,
        kind: "phase",
        attributes: { phase: e.phase, phaseName: e.phaseName, phaseDescription: e.phaseDescription },
    };
}

function mapTaskStarted(e: TaskStartedEvent): SpanOperation {
    return {
        action: "startSpan",
        name: e.statement,
        kind: "task",
        attributes: {
            taskId: e.taskId,
            statement: e.statement,
            ...(e.parentId !== null ? { parentId: e.parentId } : {}),
        },
    };
}

function mapTaskCompleted(e: TaskCompletedEvent): SpanOperation {
    return {
        action: "endSpan",
        status: e.status === "failed" ? "error" : "ok",
        attributes: { taskId: e.taskId, status: e.status, action: e.action },
    };
}

function mapToolCalled(e: ToolCalledEvent): SpanOperation {
    return {
        action: "startSpan",
        name: e.toolName,
        kind: "tool",
        attributes: { toolName: e.toolName, taskId: e.taskId, workerIndex: e.workerIndex },
    };
}

function mapToolResult(e: ToolResultEvent): SpanOperation {
    return {
        action: "endSpan",
        status: e.success ? "ok" : "error",
        attributes: { toolName: e.toolName, taskId: e.taskId, durationMs: e.durationMs, success: e.success },
    };
}

function mapThinking(e: ThinkingEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "thinking",
        attributes: { role: e.role, content: e.content.slice(0, 512) },
    };
}

function mapVerificationResult(e: VerificationResultEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "verification",
        attributes: {
            passed: e.passed,
            iteration: e.iteration,
            maxIterations: e.maxIterations,
            checksCount: e.checks.length,
        },
    };
}

function mapCostUpdate(e: CostUpdateEvent): SpanOperation {
    return {
        action: "setAttributes",
        attributes: {
            inputTokens: e.inputTokens,
            outputTokens: e.outputTokens,
            cacheReadTokens: e.cacheReadTokens,
            totalCostUsd: e.totalCostUsd,
        },
    };
}

function mapMemorySaved(e: MemorySavedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "memory.saved",
        attributes: { memoryId: e.memoryId, layer: e.layer, tags: e.tags.join(",") },
    };
}

function mapMemoryRecalled(e: MemoryRecalledEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "memory.recalled",
        attributes: { query: e.query.slice(0, 256), resultsCount: e.resultsCount },
    };
}

function mapMemorySync(e: MemorySyncEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "memory.sync",
        attributes: { imported: e.imported, entries: e.entries, developers: e.developers },
    };
}

function mapApprovalRequested(e: ApprovalRequestedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "approval.requested",
        attributes: { taskId: e.taskId, description: e.description.slice(0, 256) },
    };
}

function mapApprovalReceived(e: ApprovalReceivedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "approval.received",
        attributes: { taskId: e.taskId, approved: e.approved },
    };
}

function mapWorkerAssigned(e: WorkerAssignedEvent): SpanOperation {
    return {
        action: "startSpan",
        name: `worker-${e.workerIndex}`,
        kind: "agent",
        attributes: { workerIndex: e.workerIndex, taskId: e.taskId },
    };
}

function mapError(e: ErrorEvent): SpanOperation {
    return {
        action: "endSpan",
        status: "error",
        attributes: {
            "exception.message": e.message,
            "exception.type": e.code,
            ...(e.taskId !== null ? { taskId: e.taskId } : {}),
        },
    };
}

function mapTraceSpan(e: TraceSpanEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "trace_span",
        attributes: {
            spanId: e.span.spanId,
            traceId: e.span.traceId,
            spanName: e.span.name,
            spanKind: e.span.kind,
            spanStatus: e.span.status,
            ...(e.span.parentSpanId !== null ? { parentSpanId: e.span.parentSpanId } : {}),
        },
    };
}

function mapHandoffRequested(e: HandoffRequestedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "handoff.requested",
        attributes: { fromAgent: e.fromAgent, toAgent: e.toAgent, reason: e.reason.slice(0, 256) },
    };
}

function mapHandoffCompleted(e: HandoffCompletedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "handoff.completed",
        attributes: { fromAgent: e.fromAgent, toAgent: e.toAgent, accepted: e.accepted },
    };
}

function mapInterruptRequested(e: InterruptRequestedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "interrupt.requested",
        attributes: { checkpointId: e.checkpointId, reason: e.reason.slice(0, 256) },
    };
}

function mapInterruptResumed(e: InterruptResumedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "interrupt.resumed",
        attributes: { checkpointId: e.checkpointId },
    };
}

function mapInjectionScanned(e: InjectionScannedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "security.injection_scan",
        attributes: { safe: e.safe, threats: e.threats, tier: e.tier, inputPreview: e.inputPreview.slice(0, 256) },
    };
}

function mapGuardianReviewed(e: GuardianReviewedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "security.guardian_review",
        attributes: {
            approved: e.approved,
            capabilityName: e.capabilityName,
            agentName: e.agentName,
            riskLevel: e.riskLevel,
            reason: e.reason.slice(0, 256),
        },
    };
}

function mapAuditEntry(e: AuditEntryEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "security.audit",
        attributes: { action: e.action, actor: e.actor, outcome: e.outcome, resource: e.resource },
    };
}

function mapTenantIsolationViolation(e: TenantIsolationViolationEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "security.tenant_violation",
        attributes: { tenantId: e.tenantId, resource: e.attemptedResource, blockedBy: e.blockedBy },
    };
}

function mapSecurityAlert(e: SecurityAlertEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "security.alert",
        attributes: { severity: e.severity, category: e.category, message: e.message.slice(0, 256) },
    };
}

function mapWebhookReceived(e: WebhookReceivedEvent): SpanOperation {
    return {
        action: "startSpan",
        name: "trigger.webhook",
        kind: "trigger",
        attributes: { path: e.path, appName: e.appName, triggerName: e.triggerName, method: e.method },
    };
}

function mapTriggerFired(e: TriggerFiredEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "trigger.fired",
        attributes: { triggerName: e.triggerName, triggerType: e.triggerType, team: e.team, task: e.task },
    };
}

function mapTriggerFailed(e: TriggerFailedEvent): SpanOperation {
    return {
        action: "endSpan",
        status: "error",
        attributes: {
            triggerName: e.triggerName,
            triggerType: e.triggerType,
            "exception.message": e.error,
        },
    };
}

function mapScheduleFired(e: ScheduleFiredEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "trigger.schedule_fired",
        attributes: { triggerName: e.triggerName, cron: e.cron, team: e.team },
    };
}

function mapPiiDetected(e: PiiDetectedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "safety.pii_detected",
        attributes: {
            direction: e.direction,
            piiTypes: e.piiTypes.join(","),
            action: e.action,
            count: e.count,
            tier: e.tier,
        },
    };
}

function mapContentClassified(e: ContentClassifiedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "safety.content_classified",
        attributes: {
            direction: e.direction,
            blocked: e.blocked,
            tier: e.tier,
        },
    };
}

function mapPolicyEvaluated(e: PolicyEvaluatedEvent): SpanOperation {
    return {
        action: "addEvent",
        name: "safety.policy_evaluated",
        attributes: {
            railType: e.railType,
            allowed: e.allowed,
            direction: e.direction,
            ...(e.reason ? { reason: e.reason.slice(0, 256) } : {}),
        },
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Maps a KilnEvent to a SpanOperation descriptor.
 * Exhaustive -- adding a new EventType without updating this switch is a compile error.
 */
export function mapEventToSpan(event: KilnEvent): SpanOperation {
    switch (event.type) {
        case "phase_changed":
            return mapPhaseChanged(event as PhaseChangedEvent);
        case "task_started":
            return mapTaskStarted(event as TaskStartedEvent);
        case "task_completed":
            return mapTaskCompleted(event as TaskCompletedEvent);
        case "tool_called":
            return mapToolCalled(event as ToolCalledEvent);
        case "tool_result":
            return mapToolResult(event as ToolResultEvent);
        case "thinking":
            return mapThinking(event as ThinkingEvent);
        case "verification_result":
            return mapVerificationResult(event as VerificationResultEvent);
        case "cost_update":
            return mapCostUpdate(event as CostUpdateEvent);
        case "memory_saved":
            return mapMemorySaved(event as MemorySavedEvent);
        case "memory_recalled":
            return mapMemoryRecalled(event as MemoryRecalledEvent);
        case "memory_sync":
            return mapMemorySync(event as MemorySyncEvent);
        case "approval_requested":
            return mapApprovalRequested(event as ApprovalRequestedEvent);
        case "approval_received":
            return mapApprovalReceived(event as ApprovalReceivedEvent);
        case "worker_assigned":
            return mapWorkerAssigned(event as WorkerAssignedEvent);
        case "error":
            return mapError(event as ErrorEvent);
        case "trace_span":
            return mapTraceSpan(event as TraceSpanEvent);
        case "handoff_requested":
            return mapHandoffRequested(event as HandoffRequestedEvent);
        case "handoff_completed":
            return mapHandoffCompleted(event as HandoffCompletedEvent);
        case "interrupt_requested":
            return mapInterruptRequested(event as InterruptRequestedEvent);
        case "interrupt_resumed":
            return mapInterruptResumed(event as InterruptResumedEvent);
        case "injection_scanned":
            return mapInjectionScanned(event as InjectionScannedEvent);
        case "guardian_reviewed":
            return mapGuardianReviewed(event as GuardianReviewedEvent);
        case "audit_entry":
            return mapAuditEntry(event as AuditEntryEvent);
        case "tenant_isolation_violation":
            return mapTenantIsolationViolation(event as TenantIsolationViolationEvent);
        case "security_alert":
            return mapSecurityAlert(event as SecurityAlertEvent);
        case "webhook_received":
            return mapWebhookReceived(event as WebhookReceivedEvent);
        case "trigger_fired":
            return mapTriggerFired(event as TriggerFiredEvent);
        case "trigger_failed":
            return mapTriggerFailed(event as TriggerFailedEvent);
        case "schedule_fired":
            return mapScheduleFired(event as ScheduleFiredEvent);
        case "pii_detected":
            return mapPiiDetected(event as PiiDetectedEvent);
        case "content_classified":
            return mapContentClassified(event as ContentClassifiedEvent);
        case "policy_evaluated":
            return mapPolicyEvaluated(event as PolicyEvaluatedEvent);
        default: {
            // Exhaustiveness guard: TypeScript will produce a compile error here if a new
            // EventType is added without a corresponding case above, because event.type
            // narrows to `never` when all cases are covered.
            const _exhaustive: never = event.type;
            throw new Error(`Unhandled event type: ${_exhaustive}`);
        }
    }
}
