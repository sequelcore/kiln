# Configuration Property Ownership

This is the Roadmap 12 property-level ledger for the four canonical YAML
families. It records current ownership and reachability; it is not an editor
schema and does not grant runtime authority. ADR-014 owns schema and mutation
design. ADR-015 owns model-facing execution authority.

Each row below is one leaf property. `<id>` represents a property of a keyed
record and `[]` one repeated record. A row ending in `.*`, `[]`, or a named
object without a leaf is a shape binding only when the referenced owner defines
one shared record and every leaf has the same ledger classification; differing
members are split into their own rows. A row inherits the reader, writer,
consumer, durable store, and scope from its profile. This keeps those facts
explicit without repeating them hundreds of times.

## Profile And Classification Key

| Profile | Structural owner | Semantic owner | Reader | Current writer | Main consumers | Durable store and scope |
| --- | --- | --- | --- | --- | --- | --- |
| `G` | CLI `KilnGlobalConfig` validators | CLI configuration | `readGlobalConfig` | configuration mutation authority via `commitGlobalConfigBytes` | composition, status, CLI/GUI/TUI | `~/.kiln/config.yaml`; global |
| `GG` | CLI work-governance shape | work-governance application | `readGlobalConfig` | configuration mutation authority | work admission and managed work | global; project may narrow |
| `GR` | CLI catalog shape | Core execution routing/economics | `readGlobalConfig` | configuration mutation authority, typed target operations | Runtime route admission | global only |
| `GE` | CLI managed-evidence schema | Core data-policy/routing/economics | `readGlobalExecutionTargetAuthority` | evidence publication and target migration | Runtime route admission | `~/.kiln/evidence/execution-targets/<sha256>.json`; global, immutable |
| `GP` | CLI permission shape | CLI configured admission; Core owns effects | `readGlobalConfig` | configuration mutation authority | every model-facing surface | global bound/default |
| `GM` | Core MCP shape, CLI boundary validator | Core MCP admission | `readMcpConfigurationSource` | configuration mutation authority | MCP resolution and native projection | global; project may narrow/override server fields |
| `GC` | Core contract persisted by CLI | named Core communication/voice/gateway owner | `readGlobalConfig` | configuration mutation authority | policy resolver or Runtime ingress | global only unless the row says project precedence |
| `P` | CLI `KilnProjectConfig` | CLI project composition | `readKilnYaml` | config mutation authority (`writeKilnYaml` remains for `kiln init` only) | run, status, GUI/TUI, Tools MCP | `.kiln/kiln.yaml`; project |
| `PP` | shared CLI permission shape | CLI configured admission | `readKilnYaml` | project mutation paths | every model-facing surface | project; attenuation only |
| `A` | Core `RawApp`/`AppLoader` | Core app domain | `parseAppYaml` | init; cron for triggers | App Gateway and Core validators | `app.yaml`; deployable app |
| `AS` | separate Core app-side reader | Runtime/provider/events owner | specialized YAML reader | no shared writer | Runtime startup/request path | same `app.yaml`; deployable app |
| `W` | Core `RawGateway`/gateway loader | Core gateway domain | `parseGatewayYaml` | init template only | Runtime App/Model Gateway | `gateway.yaml`; deployment |
| `D` | `ResolvedKilnConfig` only | projection owner | global/project composition | none | status/runtime if reachable | derived; never canonical state |

Plane is `I` desired intent, `E` managed evidence, or `P` derived projection.
Sensitivity/authority is `L` low, `M` material, `H` high, or `C` critical;
`ref` means a credential or secret reference, never secret bytes. Activation is
`hot`, `turn`, `session`, `reconcile`, `restart`, or `T4`/`T9`: currently
unknown and transferred to the Slice 4 CLI mutation owner or Slice 9 Core
app/gateway owner. Disposition is `supported`, `managed-evidence`,
`projection`, `obsolete`, or `unreachable`.

## Global Configuration

Structural evidence:
[`global-config.ts`](../../../packages/cli/src/config/global-config.ts) and
[`kiln-yaml-types.ts`](../../../packages/cli/src/kiln-yaml-types.ts). Imported
contract semantics remain with their Core owner.

| Canonical property | Profile | Plane | Sensitivity / authority | Merge or default | Activation | Disposition / transfer |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | G | I | L | breaking generations only; required | session | supported |
| `identity.name` | G | I | L | absent | hot | supported |
| `identity.timezone` | G | I | L | absent | hot | supported |
| `activeInstructionProfiles[]` | G | I | M | project list appends/deduplicates | reconcile | supported |
| `workGovernance.defaultPosture` | GG | I | H | central default `direct`; project may narrow | turn | supported |
| `workGovernance.requireDelegationFor[]` | GG | I | H | union/deduplicate | turn | supported |
| `workGovernance.requiredEvidence[]` | GG | I | H | union/deduplicate | turn | supported |
| `workGovernance.boundedWorkCeiling.allowedEffects[]` | GG | I | C | global ceiling; intersect | turn | supported |
| `workGovernance.boundedWorkCeiling.allowedRoots[]` | GG | I | C | global ceiling; intersect | turn | supported |
| `workGovernance.boundedWorkCeiling.deniedRoots[]` | GG | I | C | global ceiling; union deny | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxExecutionAttempts` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxManagedInvocations` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxConcurrentManagedInvocations` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxChildDepth` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxReviewRounds` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxRemediationRounds` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxToolCalls` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.maximumLimits.maxActiveDurationMs` | GG | I | C | global maximum | turn | supported |
| `workGovernance.boundedWorkCeiling.minimumHarnessCapability` | GG | I | C | global minimum | turn | supported |
| `engines.<id>.enabled` | G | I | H | engine default; no project override | reconcile | supported |
| `engines.<id>.billing` | G | I | M | engine metadata | reconcile | supported |
| `targetCatalog.evidenceRevision` | GR | I | C | exact SHA-256 evidence reference | session | supported |
| `targetCatalog.accounts[].id` | GR | I | H | required, unique | session | supported |
| `targetCatalog.accounts[].providerId` | GR | I | H | required | session | supported |
| `targetCatalog.accounts[].credentialId` | GR | I | H ref | opaque reference | session | supported |
| `targetCatalog.accounts[].maxConcurrency` | GR | I | H | required positive | session | supported |
| `targetCatalog.accounts[].reservedAffinitySlots` | GR | I | H | bounded by concurrency | session | supported |
| `executionTargetEvidence.accounts[].economics.capacityIdentity` | GE | E | H | capacity evidence identity | session | managed-evidence |
| `executionTargetEvidence.accounts[].economics.subscriptionClass` | GE | E | M | validated evidence | session | managed-evidence |
| `executionTargetEvidence.accounts[].economics.quotaClassId` | GE | E | H | quota evidence identity | session | managed-evidence |
| `targetCatalog.accounts[].economics.creditPosture` | GR | I | H | disabled or committed | session | supported |
| `targetCatalog.accounts[].economics.overagePosture` | GR | I | H | disabled or committed | session | supported |
| `targetCatalog.accountPolicies[].id` | GR | I | H | required, unique | session | supported |
| `targetCatalog.accountPolicies[].accountIds[]` | GR | I | H | non-empty, same provider | session | supported |
| `targetCatalog.accountPolicies[].strategy` | GR | I | H | `economic-least-pressure` | session | supported |
| `targetCatalog.targets[].id` | GR | I | H | required, unique | session | supported |
| `targetCatalog.targets[].kind` | GR | I | H | direct or harness | session | supported |
| `targetCatalog.targets[].label` | GR | I | L | required | session | supported |
| `targetCatalog.targets[].providerId` | GR | I | H | required | session | supported |
| `targetCatalog.targets[].providerModelId` | GR | I | H | required | session | supported |
| `targetCatalog.targets[].accountSelection.mode` | GR | I | H | exact or automatic | session | supported |
| `targetCatalog.targets[].accountSelection.accountPolicyId` | GR | I | H | automatic only | session | supported |
| `targetCatalog.targets[].accountSelection.accountId` | GR | I | H | exact only | session | supported |
| `targetCatalog.targets[].dataClassification` | GR | I | C | required | session | supported |
| `executionTargetEvidence.version` | GE | E | H | schema version 1 | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.providerId` | GE | E | H | must match intent | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.providerRouteId` | GE | E | H | discovered route identity | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.providerModelId` | GE | E | H | must match intent | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.evidenceIdentity` | GE | E | H | required source identity | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.evidenceRevision` | GE | E | H | SHA-256 | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.observedAt` | GE | E | H | timestamp | session | managed-evidence |
| `executionTargetEvidence.targets[].discovery.expiresAt` | GE | E | H | must be current | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.providerId` | GE | E | C | must match route | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.providerModelId` | GE | E | C | must match route | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.dataUse` | GE | E | C | validated evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.trainingPosture` | GE | E | C | validated evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.retention.posture` | GE | E | C | validated evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.retention.days` | GE | E | C | non-negative | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.permittedMaximumClassification` | GE | E | C | validated evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.permittedClassifications[]` | GE | E | C | non-empty | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.sourceIdentity` | GE | E | M | required | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.sourceRevision` | GE | E | M | required | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.sourceDigest` | GE | E | M | SHA-256 | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.observedAt` | GE | E | M | timestamp | session | managed-evidence |
| `executionTargetEvidence.targets[].dataPolicyEvidence.expiresAt` | GE | E | M | timestamp | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.adapterCapabilityId` | GE | E | H | adapter evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.adapterCapabilityVersion` | GE | E | H | adapter evidence | session | managed-evidence |
| `targetCatalog.targets[].economics.authBillingChannel` | GR | I | H | dispatch constraint | session | supported |
| `targetCatalog.targets[].economics.executionMode` | GR | I | H | dispatch constraint | session | supported |
| `targetCatalog.targets[].economics.serviceTier` | GR | I | H | dispatch constraint | session | supported |
| `executionTargetEvidence.targets[].economics.rateCardBasis` | GE | E | M | evidence basis | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.envelopeSemantics` | GE | E | M | evidence semantics | session | managed-evidence |
| `targetCatalog.targets[].economics.fallbackPosture` | GR | I | H | disabled or committed | session | supported |
| `targetCatalog.targets[].economics.overagePosture` | GR | I | H | disabled or committed | session | supported |
| `executionTargetEvidence.targets[].economics.contextClass` | GE | E | M | adapter evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.cacheClass` | GE | E | M | adapter evidence | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.priceEvidence.*` | GE | E | H | Core price-evidence union | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.auxiliaryCharges[].id` | GE | E | M | unique evidence identity | session | managed-evidence |
| `executionTargetEvidence.targets[].economics.auxiliaryCharges[].amount` | GE | E | H | managed economic amount | session | managed-evidence |
| `targetCatalog.targets[].economics.executionEnvelope.limits[]` | GR | I | H | bounded economic envelope | session | supported |
| `targetCatalog.targets[].remoteHarness.invokeUrl` | GR | I | C | harness only | session | supported |
| `targetCatalog.targets[].remoteHarness.cancelUrl` | GR | I | C | harness only | session | supported |
| `targetCatalog.targets[].remoteHarness.authTokenEnv` | GR | I | C ref | harness only | session | supported |
| `executionTargetEvidence.targets[].limitations[]` | GE | E | H | harness only | session | managed-evidence |
| `targetCatalog.targets[].externalRuntimeAttachment.runtimeId` | GR | I | C | exact attachment | session | supported |
| `targetCatalog.targets[].externalRuntimeAttachment.attachmentId` | GR | I | C | exact attachment | session | supported |
| `targetRouting.defaultTargetId` | GR | I | H | required reference when present | session | supported |
| `sessionTurnBudget.tokenLimit` | G | I | H | positive | turn | supported |
| `sessionTurnBudget.action` | G | I | H | `stop` | turn | supported |
| `permissionCeiling.approval` | GP | I | C | intersects global permissions | session | supported until typed bounds replace it in Slice 1 |
| `permissionCeiling.sandbox` | GP | I | C | intersects global permissions | session | supported until typed bounds replace it in Slice 1 |
| `verification.formal.dafny.executable` | G | I | H ref | exact operator selection | session | supported |
| `verification.formal.dafny.expectedVersion` | G | I | H | exact match | session | supported |
| `ui.theme` | G | I | L | absent | hot | supported |
| `ui.targetSelection.targetId` | GR | I | H | admitted direct target | session | supported |
| `ui.targetSelection.accountOverrideId` | GR | I | H | eligible automatic target account | session | supported |
| `components.include[]` | G | I | M | central default baseline | reconcile | supported |

### Shared global policy records

The following rows expand the shared shapes used by global config. Evidence is
the corresponding interface in `kiln-yaml-types.ts` or the imported Core
contract named by the profile.

| Canonical property | Profile | Plane | Sensitivity / authority | Merge or default | Activation | Disposition / transfer |
| --- | --- | --- | --- | --- | --- | --- |
| `permissions.approval` | GP | I | C | central on-request default; restrictive composition | session | supported; vocabulary replaced in Slice 1 |
| `permissions.sandbox` | GP | I | C | central read-only default; minimum wins | session | supported |
| `permissions.safeDefaults` | GP | I | C | product baseline | session | supported |
| `permissions.auditLog` | GP | I | H | model-facing enabled | session | supported |
| `permissions.tools[].tool` | GP | I | C | canonical selector | session | supported |
| `permissions.tools[].action` | GP | I | C | ordered within global; restrictive across layers | session | supported; vocabulary replaced in Slice 1 |
| `permissions.tools[].reason` | GP | I | L | explanatory | session | supported |
| `permissions.commands[].pattern` | GP | I | C | ordered within global | session | supported |
| `permissions.commands[].action` | GP | I | C | restrictive across layers | session | supported; vocabulary replaced in Slice 1 |
| `permissions.commands[].shell` | GP | I | H | optional selector | session | supported |
| `permissions.commands[].reason` | GP | I | L | explanatory | session | supported |
| `permissions.fileGovernance.excludeFromContext` | GP | I | H | true attenuates | session | supported |
| `permissions.fileGovernance.denyGlobs[]` | GP | I | C | deny precedence | session | supported |
| `permissions.fileGovernance.askGlobs[]` | GP | I | C | approval required | session | supported |
| `permissions.fileGovernance.allowGlobs[]` | GP | I | C | cannot override higher deny | session | supported |
| `permissions.memory.read[].operations[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.read[].scopeKinds[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.read[].scopeIds[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.read[].layers[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.read[].allowAuditWrite` | GP | I | C | explicit grant | session | supported |
| `permissions.memory.write[].operations[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.write[].scopeKinds[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.write[].scopeIds[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.write[].layers[]` | GP | I | C | grant set | session | supported |
| `permissions.memory.write[].allowAuditWrite` | GP | I | C | explicit grant | session | supported |
| `permissions.dataFirewall[].destination` | GP | I | C | no-match denies | session | supported |
| `permissions.dataFirewall[].action` | GP | I | C | deny/redact/allow | session | supported; vocabulary review Slice 1 |
| `permissions.dataFirewall[].classifications[]` | GP | I | C | selector | session | supported |
| `permissions.dataFirewall[].reason` | GP | I | L | explanatory | session | supported |
| `permissions.agentScopes[].agent` | GP | I | C | unique scope | session | supported |
| `permissions.agentScopes[].inherit` | GP | I | C | only true; false rejects | session | obsolete; remove in Slice 1 |
| `permissions.agentScopes[].tools[]` | GP | I | C | child attenuation | session | supported |
| `permissions.agentScopes[].commands[]` | GP | I | C | child attenuation | session | supported |
| `permissions.agentScopes[].fileGovernance` | GP | I | C | child attenuation | session | supported |
| `permissions.agentScopes[].memory` | GP | I | C | grant intersection | session | supported |
| `permissions.agentScopes[].mcpTools[]` | GP | I | C | set intersection | session | supported |
| `authorityProfiles[].id` | GP | I | C | required unique | session | supported |
| `authorityProfiles[].admissionProfile` | GP | I | C | named profile | session | supported |
| `authorityProfiles[].voiceProfile` | GP | I | H | reference | session | supported |
| `authorityProfiles[].workingDirectory` | GP | I | C | bounded enum | session | supported |
| `authorityProfiles[].timeoutMs` | GP | I | H | positive | session | supported |
| `authorityProfiles[].tools.allowed[]` | GP | I | C | allow set | session | supported |
| `authorityProfiles[].tools.network` | GP | I | C | explicit capability | session | supported |
| `authorityProfiles[].tools.writes` | GP | I | C | explicit capability | session | supported |
| `authorityProfiles[].memory.access` | GP | I | C | explicit capability | session | supported |
| `authorityProfiles[].readAuthority.workspace.allowedPaths[]` | GP | I | C | allow set | session | supported |
| `authorityProfiles[].readAuthority.workspace.deniedPaths[]` | GP | I | C | deny set | session | supported |
| `authorityProfiles[].writeAuthority.workspace.mode` | GP | I | C | bounded write mode | session | supported |
| `authorityProfiles[].writeAuthority.workspace.allowedPaths[]` | GP | I | C | allow set | session | supported |
| `authorityProfiles[].writeAuthority.workspace.deniedPaths[]` | GP | I | C | deny set | session | supported |
| `authorityProfiles[].writeAuthority.memory.mode` | GP | I | C | bounded write mode | session | supported |
| `authorityProfiles[].writeAuthority.memory.operations[]` | GP | I | C | allow set | session | supported |
| `authorityProfiles[].writeAuthority.artifacts.mode` | GP | I | C | bounded write mode | session | supported |
| `authorityProfiles[].writeAuthority.artifacts.resourceUris[]` | GP | I | C | allow set | session | supported |
| `authorityProfiles[].writeAuthority.artifacts.retention` | GP | I | H | retention authority | session | supported |
| `authorityProfiles[].writeAuthority.tools.allowed[]` | GP | I | C | allow set | session | supported |
| `authorityProfiles[].writeAuthority.tools.denied[]` | GP | I | C | deny set | session | supported |
| `authorityProfiles[].writeAuthority.approval.mode` | GP | I | C | required | session | supported |
| `authorityProfiles[].writeAuthority.approval.approver` | GP | I | C | authority reference | session | supported |
| `authorityProfiles[].writeAuthority.approval.evidenceUris[]` | GP | E | H | evidence reference | session | managed-evidence |
| `managedAgents.enabled` | GR | I | H | absent disables by consumer default | session | supported |
| `managedAgents.defaultAuthorityProfileId` | GR | I | C | profile reference | session | supported |
| `managedAgents.defaultVoiceProfile` | GR | I | H | voice reference | session | supported |
| `managedAgents.requireApproval` | GR | I | C | explicit | session | supported |
| `managedAgents.worktreeLease.mode` | GR | I | C | `git` | session | supported |
| `managedAgents.worktreeLease.rootPath` | GR | I | C | operator path | session | supported; not portable project state |
| `managedAgents.worktreeLease.ref` | GR | I | H | optional | session | supported |
| `managedAgents.worktreeLease.gitBinary` | GR | I | H ref | optional command | session | supported |
| `managedAgents.economicPolicies[].id` | GR | I | H | unique | session | supported |
| `managedAgents.economicPolicies[].revision` | GE | E | M | required | session | managed-evidence |
| `managedAgents.economicPolicies[].evidenceRequirements.quota` | GR | I | H | required policy | session | supported |
| `managedAgents.economicPolicies[].evidenceRequirements.price` | GR | I | H | required policy | session | supported |
| `managedAgents.economicPolicies[].noRouteAction` | GR | I | C | `deny` | session | supported |
| `managedAgents.economicPolicies[].comparisonDomains[].id` | GR | I | H | unique | session | supported |
| `managedAgents.economicPolicies[].comparisonDomains[].rank` | GR | I | H | unique non-negative | session | supported |
| `managedAgents.economicPolicies[].comparisonDomains[].unit` | GE | E | M | evidence unit | session | managed-evidence |
| `managedAgents.economicPolicies[].comparisonDomains[].scheme` | GE | E | M | evidence scheme | session | managed-evidence |
| `managedAgents.economicPolicies[].comparisonDomains[].rateCardBasis` | GE | E | M | evidence basis | session | managed-evidence |
| `managedAgents.economicPolicies[].comparisonDomains[].envelopeSemantics` | GE | E | M | evidence semantics | session | managed-evidence |
| `managedAgents.economicPolicies[].candidates[].targetId` | GR | I | H | route reference | session | supported |
| `managedAgents.economicPolicies[].candidates[].comparisonDomainId` | GR | I | H | domain reference | session | supported |
| `managedAgents.economicPolicies[].candidates[].priorityRank` | GR | I | H | non-negative | session | supported |
| `managedAgents.economicPolicies[].candidates[].worstCaseReservation` | GE | E | H | exact/comparable evidence | session | managed-evidence |
| `managedAgents.economicPolicies[].candidates[].ceiling.kind` | GR | I | H | none or finite | session | supported |
| `managedAgents.economicPolicies[].candidates[].ceiling.amount` | GR | I | H | finite only | session | supported |
| `modelTaskSuitability[].provider` | GC | I | M | route selector | turn | supported |
| `modelTaskSuitability[].model` | GC | I | M | route selector | turn | supported |
| `modelTaskSuitability[].task` | GC | I | M | task selector | turn | supported |
| `modelTaskSuitability[].level` | GC | E | M | operator evidence | turn | managed-evidence review Slice 3 |
| `modelTaskSuitability[].reason` | GC | E | L | rationale | turn | managed-evidence review Slice 3 |
| `deliberationPolicy.default` | GC | I | M | provider-neutral rule | turn | supported |
| `deliberationPolicy.byTask.<task>` | GC | I | M | overrides default | turn | supported |
| `deliberationPolicy.byRoute[].provider` | GC | I | M | route selector | turn | supported |
| `deliberationPolicy.byRoute[].model` | GC | I | M | route selector | turn | supported |
| `deliberationPolicy.byRoute[].mode` | GC | I | M | rule union | turn | supported |
| `deliberationPolicy.byRoute[].preferredLevel` | GC | I | M | fixed mode | turn | supported |
| `deliberationPolicy.byRoute[].target` | GC | I | M | adaptive mode | turn | supported |
| `deliberationPolicy.byRoute[].bounds.min` | GC | I | M | optional bound | turn | supported |
| `deliberationPolicy.byRoute[].bounds.max` | GC | I | M | optional bound | turn | supported |
| `deliberationPolicy.byRoute[].onUnsupported` | GC | I | H | fail posture | turn | supported |
| `communication.responseDetail` | GC | I | L | project precedes global | turn | supported |
| `communication.interactionProfile.id` | GC | I | M | project precedes global | turn | supported |
| `communication.interactionProfile.revision` | GC | E | M | exact reference | turn | managed-evidence |
| `communication.interactionProfile.behaviors[]` | GC | I | M | required behaviors | turn | supported |
| `communication.locale` | GC | I | L | project precedes global | turn | supported |
| `communication.requiredContent[]` | GC | I | H | union by resolver | turn | supported |
| `communication.artifactContract.id` | GC | I | M | exact reference | turn | supported |
| `communication.artifactContract.revision` | GC | E | M | exact reference | turn | managed-evidence |
| `communication.responseSkills[].id` | GC | I | M | exact reference | turn | supported |
| `communication.responseSkills[].revision` | GC | E | M | exact reference | turn | managed-evidence |
| `communication.onUnsupported` | GC | I | H | deny or omit | turn | supported |
| `web.searchProvider` | G | I | H ref | global provider default | session | supported |
| `web.searchFallbackProviders[]` | G | I | H ref | ordered fallback | session | supported |
| `web.extractProvider` | G | I | H ref | global provider default | session | supported |
| `skills.builtin.enabled` | G | I | M | product default true | reconcile | supported |
| `skills.builtin.include[]` | G | I | M | project list merges | reconcile | supported |
| `skills.builtin.exclude[]` | G | I | M | project list merges | reconcile | supported |
| `skills.selection.mode` | G | I | M | project override | session | supported |
| `skills.visibility.default` | G | I | H | global only | reconcile | supported |
| `skills.visibility.overrides.<id>` | G | I | H | global only | reconcile | supported |
| `skills.externalCatalog.version` | G | I | H | global only | reconcile | supported |
| `skills.externalCatalog.harnesses.<id>.expectedFingerprint` | G | E | H | exact native evidence | reconcile | managed-evidence |
| `skills.externalCatalog.harnesses.<id>.keepImplicit[].sourceId` | G | I | H | reviewed allow decision | reconcile | supported |
| `skills.externalCatalog.harnesses.<id>.keepImplicit[].packageDigest` | G | E | H | exact package evidence | reconcile | managed-evidence |
| `mcp.servers.<id>.enabled` | GM | I | H | project may disable | reconcile | supported |
| `mcp.servers.<id>.transport` | GM | I | C | stdio or HTTP | reconcile | supported |
| `mcp.servers.<id>.command` | GM | I | C | stdio only | reconcile | supported |
| `mcp.servers.<id>.args[]` | GM | I | C | stdio only | reconcile | supported |
| `mcp.servers.<id>.cwd` | GM | I | C | stdio only | reconcile | supported |
| `mcp.servers.<id>.env.<key>` | GM | I | C ref | value/env/credential reference | reconcile | supported |
| `mcp.servers.<id>.url` | GM | I | C | HTTP only | reconcile | supported |
| `mcp.servers.<id>.headers.<key>` | GM | I | C ref | value/env/credential reference | reconcile | supported |
| `mcp.servers.<id>.startupTimeoutMs` | GM | I | H | positive | reconcile | supported |
| `mcp.servers.<id>.requestTimeoutMs` | GM | I | H | positive | reconcile | supported |
| `mcp.servers.<id>.maxCapabilities` | GM | I | H | positive ceiling | reconcile | supported |
| `mcp.servers.<id>.reconnect.maxAttempts` | GM | I | H | non-negative | reconcile | supported |
| `mcp.servers.<id>.reconnect.initialDelayMs` | GM | I | M | non-negative | reconcile | supported |
| `mcp.servers.<id>.reconnect.maxDelayMs` | GM | I | M | non-negative | reconcile | supported |
| `mcp.servers.<id>.admission.state` | GM | I | C | deny/admit | reconcile | supported |
| `mcp.servers.<id>.admission.tools` | GM | I | C | allow/deny lists | reconcile | supported |
| `mcp.servers.<id>.admission.resources` | GM | I | C | allow/deny lists | reconcile | supported |
| `mcp.servers.<id>.admission.prompts` | GM | I | C | allow/deny lists | reconcile | supported |
| `mcp.servers.<id>.admission.effects.<tool>` | GM | I | C | absolute maximum effect | reconcile | supported |
| `mcp.servers.<id>.trust` | GM | I | C | explicit trust class | reconcile | supported |
| `hooks.<event>[].matcher` | G | I | H | optional selector | reconcile | supported |
| `hooks.<event>[].hooks[].type` | G | I | C | command only | reconcile | supported |
| `hooks.<event>[].hooks[].command` | G | I | C | required | reconcile | supported |
| `hooks.<event>[].hooks[].timeoutSec` | G | I | H | optional | reconcile | supported |
| `hooks.<event>[].hooks[].async` | G | I | H | optional | reconcile | supported |
| `operatorVoice.stt.*` | GC | I | H ref | Core voice validator | session | supported; expanded by app voice rows below |
| `operatorVoice.tts.*` | GC | I | H ref | Core voice validator | session | supported; expanded by app voice rows below |
| `operatorVoice.defaults.*` | GC | I | M | Core voice resolver | session | supported |
| `operatorVoice.ttsProfiles.<id>.*` | GC | I | M | Core voice resolver | session | supported |
| `operatorVoice.policy.*` | GC | I | H | Core voice policy | session | supported |
| `modelGateway.port` | GC | I | C | validated listener | restart | supported |
| `modelGateway.replay.ttlMs` | GC | I | C | required | restart | supported |
| `modelGateway.replay.maxEntries` | GC | I | C | required | restart | supported |
| `modelGateway.replay.hmacKeyEnv` | GC | I | C ref | required | restart | supported |
| `modelGateway.principals[].tokenEnv` | GC | I | C ref | required | restart | supported |
| `modelGateway.principals[].ingress` | GC | I | C | required | restart | supported |
| `modelGateway.principals[].tenantId` | GC | I | C | required | restart | supported |
| `modelGateway.principals[].applicationId` | GC | I | C | required | restart | supported |
| `modelGateway.principals[].callerId` | GC | I | C | required | restart | supported |
| `modelGateway.principals[].capabilityId` | GC | I | C | required | restart | supported |
| `modelGateway.principals[].scopes[]` | GC | I | C | authority set | restart | supported |
| `modelGateway.principals[].budgetEvidenceId` | GC | E | H | evidence reference | restart | managed-evidence |
| `modelGateway.principals[].virtualModelIds[]` | GC | I | C | admitted model set | restart | supported |
| `modelGateway.principals[].nativeHarness` | GC | I | C | optional harness binding | restart | supported |
| `modelGateway.virtualModels[].id` | GC | I | H | unique | restart | supported |
| `modelGateway.virtualModels[].displayName` | GC | I | L | optional | restart | supported |
| `modelGateway.virtualModels[].contextTokens` | GC | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].outputTokens` | GC | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].baseInstructions` | GC | I | H | prompt authority | restart | supported |
| `modelGateway.virtualModels[].targetId` | GC | I | C | target reference | restart | supported |
| `modelGateway.virtualModels[].capabilities[]` | GC | E | H | capability declaration | restart | managed-evidence |
| `modelGateway.virtualModels[].deliberation.levels[]` | GC | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].deliberation.defaultLevel` | GC | I | M | optional default | restart | supported |
| `modelGateway.virtualModels[].deliberation.supportsAdaptive` | GC | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].deliberation.evidenceRevision` | GC | E | M | exact evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].affinity.continuity` | GC | I | H | none/prefer/require | restart | supported |
| `modelGateway.virtualModels[].affinity.scope` | GC | I | H | session/turn | restart | supported |
| `modelGateway.virtualModels[].affinity.allowRebind` | GC | I | H | explicit | restart | supported |
| `modelGateway.surfaces.openAIResponses.maxBodyBytes` | GC | I | H | limit | restart | supported |
| `modelGateway.surfaces.openAIResponses.maxConcurrentRequests` | GC | I | H | limit | restart | supported |
| `modelGateway.surfaces.anthropicMessages.maxBodyBytes` | GC | I | H | limit | restart | supported |
| `modelGateway.surfaces.anthropicMessages.maxConcurrentRequests` | GC | I | H | limit | restart | supported |
| `modelGateway.codexComposite.maxQueuedRequests` | GC | I | H | limit | restart | supported |
| `modelGateway.codexComposite.queueTimeoutMs` | GC | I | H | limit | restart | supported |

## Project Configuration

All rows inherit profile `P` unless marked `PP`, `GM`, or `GC`. Global-only
visibility, external-catalog, physical target, authority-profile, and gateway
fields reject at the project boundary.

| Canonical property | Profile | Plane | Sensitivity / authority | Merge or default | Activation | Disposition / transfer |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | P | I | L | required `1` | session | supported |
| `activeInstructionProfiles[]` | P | I | M | append/deduplicate | reconcile | supported |
| `workGovernance.defaultPosture` | P | I | H | project may narrow | turn | supported |
| `workGovernance.requireDelegationFor[]` | P | I | H | union/deduplicate | turn | supported |
| `workGovernance.requiredEvidence[]` | P | I | H | union/deduplicate | turn | supported |
| `workGovernance.boundedWorkCeiling.*` | P | I | C | global-only; rejects | turn | obsolete from project schema in Slice 1 |
| `domain` | P | I | L | project scalar | session | supported |
| `channels[]` | P | I | M | project scalar list | session | supported |
| `teamMode` | P | I | M | project scalar | session | supported |
| `requireApproval` | P | I | H | project scalar | session | supported |
| `maxDepth` | P | I | H | project scalar | session | supported |
| `parallelWorkers` | P | I | H | project scalar | session | supported |
| `permissions.approval` | PP | I | C | may only narrow global | session | supported; vocabulary replaced Slice 1 |
| `permissions.sandbox` | PP | I | C | may only narrow global | session | supported |
| `permissions.safeDefaults` | PP | I | C | cannot disable global baseline | session | supported |
| `permissions.auditLog` | PP | I | H | cannot disable parent audit | session | supported |
| `permissions.tools[]` | PP | I | C | restrictive meet | session | supported |
| `permissions.commands[]` | PP | I | C | restrictive meet | session | supported |
| `permissions.fileGovernance` | PP | I | C | restrictive meet | session | supported |
| `permissions.memory` | PP | I | C | grant intersection | session | supported |
| `permissions.dataFirewall[]` | PP | I | C | restrictive meet | session | supported |
| `permissions.agentScopes[]` | PP | I | C | attenuation only | session | supported |
| `mcp.servers.<id>.*` | GM | I | C ref | per-field override with narrowing admission | reconcile | supported |
| `communication.responseDetail` | GC | I | L | project precedes global | turn | supported |
| `communication.interactionProfile` | GC | I/E | M | project precedes global | turn | supported |
| `communication.locale` | GC | I | L | project precedes global | turn | supported |
| `communication.requiredContent[]` | GC | I | H | resolver composition | turn | supported |
| `communication.artifactContract` | GC | I/E | M | exact reference | turn | supported |
| `communication.responseSkills[]` | GC | I/E | M | exact references | turn | supported |
| `communication.onUnsupported` | GC | I | H | deny or omit | turn | supported |
| `web.enabled` | P | I | H | project authority | session | supported |
| `web.netPolicy` | P | I | C | project authority | session | supported |
| `web.allowedDomains[]` | P | I | C | project allow set | session | supported |
| `web.searchProvider` | P | I | H ref | overrides global provider | session | supported |
| `web.searchFallbackProviders[]` | P | I | H ref | ordered fallback | session | supported |
| `web.extractProvider` | P | I | H ref | overrides global provider | session | supported |
| `interactiveUse.enabled` | P | I | H | project authority | session | supported |
| `interactiveUse.allowedDomains[]` | P | I | C | allow set | session | supported |
| `interactiveUse.allowedApplications[]` | P | I | C | allow set | session | supported |
| `interactiveUse.applicationAliases.<id>[]` | P | I | H | alias set | session | supported |
| `interactiveUse.allowExternalBrowser` | P | I | C | explicit grant | session | supported |
| `interactiveUse.allowComputer` | P | I | C | explicit grant | session | supported |
| `interactiveUse.browserProvider` | P | I | H | explicit provider | session | supported |
| `interactiveUse.computerProvider` | P | I | H | explicit provider | session | supported |
| `interactiveUse.browserEnvironment` | P | I | H | explicit environment | session | supported |
| `interactiveUse.computerEnvironment` | P | I | H | explicit environment | session | supported |
| `skills.builtin.enabled` | P | I | M | project selection; cannot disable product authority rules | reconcile | supported |
| `skills.builtin.include[]` | P | I | M | merge/deduplicate | reconcile | supported |
| `skills.builtin.exclude[]` | P | I | M | merge/deduplicate | reconcile | supported |
| `skills.selection.mode` | P | I | M | project override | session | supported |
| `skills.visibility.*` | P | I | H | global-only; rejects | reconcile | obsolete from project schema in Slice 1 |
| `skills.externalCatalog.*` | P | I/E | H | global-only; rejects | reconcile | obsolete from project schema in Slice 1 |
| `qualityGates[].name` | P | I | M | required | session | supported |
| `qualityGates[].command` | P | I | H | required command | session | supported |
| `qualityGates[].required` | P | I | H | default true in run admission | session | supported |
| `contextGovernance.turnBudget` | P | I | H | project only | turn | supported |
| `contextGovernance.allocationMode` | P | I | H | project only | turn | supported |
| `contextGovernance.previewBeforeApply` | P | I | H | project only | turn | supported |
| `contextGovernance.preferredSources[]` | P | I | M | project only | turn | supported |
| `contextGovernance.summaryAggressiveness` | P | I | M | project only | turn | supported |
| `contextGovernance.cachePolicy` | P | I | M | project only | turn | supported |
| `contextGovernance.adaptation.version` | P | E | M | exact evidence schema | turn | supported |
| `contextGovernance.adaptation.revision` | P | E | M | monotonic evidence | turn | supported |
| `contextGovernance.adaptation.activePolicyId` | P | I | H | selected policy | turn | supported |
| `contextGovernance.adaptation.activeConfigurationHash` | P | E | H | exact evidence | turn | supported |
| `contextGovernance.adaptation.frozen` | P | I | H | explicit state | turn | supported |
| `contextGovernance.adaptation.freezeReason` | P | E | L | rationale | turn | managed-evidence |
| `contextGovernance.adaptation.rollback.policyId` | P | I | H | rollback intent | turn | supported |
| `contextGovernance.adaptation.rollback.configurationHash` | P | E | H | exact evidence | turn | managed-evidence |
| `contextGovernance.adaptation.rollback.allocationMode` | P | I | H | rollback intent | turn | supported |
| `contextGovernance.adaptation.candidateRecordHash` | P | E | M | evidence reference | turn | supported |
| `contextGovernance.adaptation.evaluationEvidenceHash` | P | E | M | evidence reference | turn | supported |

## App Configuration

Evidence:
[`app-loader.ts`](../../../packages/core/src/engine/loader/app-loader.ts),
[`runtime-mode-loader.ts`](../../../packages/core/src/engine/gateway/runtime-mode-loader.ts),
and [`events-loader.ts`](../../../packages/core/src/engine/gateway/events-loader.ts).
Rows marked unreachable are declared, parsed, or consumed on only one side of
the YAML boundary; Slice 9 owns their deletion or completed mapping.

| Canonical property | Profile | Plane | Sensitivity / authority | Default | Activation | Disposition / transfer |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | A | I | L | required | restart | supported |
| `channels[]` | A | I | M | empty | restart | supported but duplicates gateway route intent; Slice 9 resolves |
| `memory.scopes[]` | A | I | H | empty | restart | unreachable in App Gateway; Slice 9 |
| `memory.backend` | A | I | H ref | required by validator | restart | unreachable in App Gateway; Slice 9 |
| `memory.sync` | A | I | H | required by validator | restart | unreachable in App Gateway; Slice 9 |
| `router.rules[].match` | A | I | H | empty rules | restart | unreachable in App Gateway; Slice 9 |
| `router.rules[].team` | A | I | H | empty rules | restart | unreachable in App Gateway; Slice 9 |
| `router.classifier` | A | I | H | absent | restart | unreachable in App Gateway; Slice 9 |
| `router.fallback` | A | I | H | required | restart | supported |
| `teams.<team>.agents.<agent>.name` | A | I | M | required | restart | supported |
| `teams.<team>.agents.<agent>.tier` | A | I | H | `fast` | restart | supported by validator; runtime use partial |
| `teams.<team>.agents.<agent>.tools[]` | A | I | C | empty | restart | supported |
| `teams.<team>.agents.<agent>.role` | A | I | H | required | restart | supported |
| `teams.<team>.agents.<agent>.goal` | A | I | H | required | restart | supported |
| `teams.<team>.agents.<agent>.backstory` | A | I | M | absent | restart | supported |
| `teams.<team>.agents.<agent>.instructions` | A | I | H | absent | restart | supported |
| `teams.<team>.agents.<agent>.structured` | A | I | M | absent | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.agents.<agent>.count` | A | I | H | absent | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.agents.<agent>.sandbox` | A | I | C | absent | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.agents.<agent>.modalities[]` | A | I | H | text | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.agents.<agent>.voiceProfile` | A | I | H | absent | restart | validator/profile check; runtime reachability Slice 9 |
| `teams.<team>.workflow.phases[]` | A | I | H | empty | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.workflow.gates.<phase>.requires[]` | A | I | H | empty | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.workflow.maxIterations` | A | I | H | absent | restart | unreachable in App Gateway; Slice 9 |
| `teams.<team>.capabilities[].name` | A | I | H | required | restart | supported |
| `teams.<team>.capabilities[].description` | A | I | L | absent | restart | supported |
| `teams.<team>.capabilities[].schema` | A | I | H | empty object | restart | supported |
| `teams.<team>.capabilities[].tags[]` | A | I | M | empty | restart | supported |
| `teams.<team>.capabilities[].type` | A | I | H | absent | restart | supported |
| `teams.<team>.capabilities[].targetApp` | A | I | H | absent | restart | supported |
| `teams.<team>.capabilities[].task` | A | I | H | absent | restart | supported |
| `teams.<team>.capabilities[].timeout` | A | I | H | absent | restart | supported |
| `teams.<team>.capabilities[].guardrail` | A | I | C | absent | restart | supported |
| `teams.<team>.capabilities[].guardrailRetries` | A | I | H | absent | restart | supported |
| `teams.<team>.capabilities[].outputSchema` | A | I | H | absent | restart | supported |
| `teams.<team>.capabilities[].effectEnvelope` | A | I | C | conservative effect | restart | supported |
| `teams.<team>.capabilities[].retry` | A | I | H | domain default | restart | supported |
| `teams.<team>.capabilities[].cacheTtl` | A | I | H | domain only | restart | unreachable from YAML; Slice 9 |
| `teams.<team>.qualityGates[].name` | A | I | M | required | restart | parsed, runtime-unreachable; Slice 9 |
| `teams.<team>.qualityGates[].command` | A | I | H | required | restart | parsed, runtime-unreachable; Slice 9 |
| `teams.<team>.qualityGates[].description` | A | I | L | absent | restart | parsed, runtime-unreachable; Slice 9 |
| `teams.<team>.qualityGates[].required` | A | I | H | true | restart | parsed, runtime-unreachable; Slice 9 |
| `teams.<team>.quality[]` | A | I | H | alias fallback | restart | obsolete alias; delete Slice 9 |
| `teams.<team>.mode` | A | I | H | absent | restart | supported partially |
| `teams.<team>.manager` | A | I | H | absent | restart | supported |
| `teams.<team>.knowledge` | A | I | H | domain only | restart | unreachable from YAML; Slice 9 |
| `triggers[].name` | A | I | M | required | restart | supported |
| `triggers[].type` | A | I | H | required | restart | supported |
| `triggers[].team` | A | I | H | required | restart | supported |
| `triggers[].task` | A | I | H | absent | restart | supported |
| `triggers[].enabled` | A | I | H | true | restart | supported |
| `triggers[].path` | A | I | C | webhook only | restart | supported |
| `triggers[].method` | A | I | H | webhook only | restart | supported |
| `triggers[].secretEnv` | A | I | C ref | webhook only | restart | supported |
| `triggers[].event` | A | I | H | event only | restart | supported |
| `triggers[].filter` | A | I | H | event only | restart | supported |
| `triggers[].cron` | A | I | H | schedule only | restart | supported |
| `triggers[].timezone` | A | I | M | optional | restart | supported |
| `knowledge.embedding.provider` | A | I | H | required | restart | supported |
| `knowledge.embedding.model` | A | I | H | required | restart | supported |
| `knowledge.embedding.apiKeyEnv` | A | I | C ref | optional | restart | supported |
| `knowledge.embedding.baseUrl` | A | I | H | optional | restart | supported |
| `knowledge.store.backend` | A | I | H | required | restart | supported |
| `knowledge.store.connectionString` | A | I | C ref | optional literal currently admitted | restart | supported; secret-separation review Slice 9 |
| `knowledge.store.connectionStringEnv` | A | I | C ref | optional | restart | supported |
| `knowledge.chunking.strategy` | A | I | M | validator default | restart | supported |
| `knowledge.chunking.chunkSize` | A | I | M | 512 | restart | supported |
| `knowledge.chunking.chunkOverlap` | A | I | M | 50 | restart | supported |
| `knowledge.chunking.contextual` | A | I | H | domain only | restart | unreachable from YAML; Slice 9 |
| `knowledge.sources[].name` | A | I | M | required | restart | supported |
| `knowledge.sources[].path` | A | I | H | required | restart | supported |
| `knowledge.sources[].watch` | A | I | H | false | restart | supported |
| `knowledge.sources[].chunking` | A | I | M | inherits root | restart | supported |
| `knowledge.sources[].type` | A | I | H | runtime falls back to file | restart | unreachable from YAML; Slice 9 |
| `knowledge.allowedAgents[]` | A | I | H | absent | restart | supported |
| `knowledge.reranker` | A | I | H ref | domain only | restart | unreachable from YAML; Slice 9 |
| `knowledge.mode` | A | I | H | domain only | restart | unreachable from YAML; Slice 9 |
| `knowledge.contactMemory` | A | I | C | domain only | restart | unreachable from YAML; Slice 9 |
| `eval.datasets[].name` | A | I | M | required | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.datasets[].path` | A | I | H | required | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].name` | A | I | M | required | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].type` | A | I | H | required | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].scorers[]` | A | I | H | composite only | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].schema` | A | I | H | schema scorer | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].prompt` | A | I | H | LLM scorer | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].minLength` | A | I | M | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].maxLength` | A | I | M | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].maxLatencyMs` | A | I | M | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].maxCostUsd` | A | I | M | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].substrings[]` | A | I | M | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.scorers[].policies` | A | I | H | domain only | restart | unreachable from YAML; Slice 9 |
| `eval.experiments[].name` | A | I | M | required | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.experiments[].dataset` | A | I | H | reference | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.experiments[].team` | A | I | H | reference | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.experiments[].scorers[]` | A | I | H | references | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.experiments[].overrides` | A | I | H | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `eval.experiments[].compare` | A | I | M | optional | restart | parsed; runtime owner unproven, Slice 9 |
| `mcp.servers[]` | A | I | C | non-empty | restart | supported |
| `toolSelection.strategy` | A | I | H | all | restart | unreachable in App Gateway; Slice 9 |
| `toolSelection.maxTools` | A | I | H | optional | restart | unreachable in App Gateway; Slice 9 |
| `toolSelection.threshold` | A | I | H | optional | restart | unreachable in App Gateway; Slice 9 |

Voice leaf properties are shared by global `operatorVoice` and app `voice`;
the app paths below are the complete Core shape and the global rows inherit the
same semantic owner.

| Canonical property | Profile | Plane | Sensitivity / authority | Default | Activation | Disposition / transfer |
| --- | --- | --- | --- | --- | --- | --- |
| `voice.stt.provider` | A | I | H | required | restart | supported |
| `voice.stt.model` | A | I | H | optional | restart | supported |
| `voice.stt.apiKeyEnv` | A | I | C ref | optional | restart | supported |
| `voice.stt.language` | A | I | M | optional | restart | supported |
| `voice.stt.command` | A | I | C ref | local provider | restart | supported |
| `voice.stt.commandEnv` | A | I | C ref | local provider | restart | supported |
| `voice.stt.args[]` | A | I | H | optional | restart | supported |
| `voice.stt.modelPath` | A | I | H ref | optional | restart | supported |
| `voice.stt.modelPathEnv` | A | I | H ref | optional | restart | supported |
| `voice.stt.device` | A | I | M | optional | restart | supported |
| `voice.stt.timeoutMs` | A | I | H | optional | restart | supported |
| `voice.tts.provider` | A | I | H | required | restart | supported |
| `voice.tts.model` | A | I | H | optional | restart | supported |
| `voice.tts.apiKeyEnv` | A | I | C ref | optional | restart | supported |
| `voice.tts.voice` | A | I | M | optional | restart | supported |
| `voice.tts.command` | A | I | C ref | local provider | restart | supported |
| `voice.tts.commandEnv` | A | I | C ref | local provider | restart | supported |
| `voice.tts.args[]` | A | I | H | optional | restart | supported |
| `voice.tts.modelPath` | A | I | H ref | optional | restart | supported |
| `voice.tts.modelPathEnv` | A | I | H ref | optional | restart | supported |
| `voice.tts.device` | A | I | M | optional | restart | supported |
| `voice.tts.timeoutMs` | A | I | H | optional | restart | supported |
| `voice.tts.format` | A | I | M | optional | restart | supported |
| `voice.defaults.ttsProfile` | A | I | M | optional reference | restart | supported |
| `voice.ttsProfiles.<id>.style` | A | I | M | required | restart | supported |
| `voice.ttsProfiles.<id>.voice` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.language` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.speed` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.speedRange` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.format` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.intents.<id>.delivery` | A | I | M | required | restart | supported |
| `voice.ttsProfiles.<id>.intents.<id>.appliesWhen[]` | A | I | M | required | restart | supported |
| `voice.ttsProfiles.<id>.intents.<id>.voice` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.intents.<id>.language` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.intents.<id>.speed` | A | I | M | optional | restart | supported |
| `voice.ttsProfiles.<id>.intents.<id>.format` | A | I | M | optional | restart | supported |
| `voice.policy.defaultInputFailureMode` | A | I | C | optional | restart | supported |
| `voice.policy.defaultOutputFailureMode` | A | I | C | optional | restart | supported |
| `voice.policy.artifacts.storeSourceAudio` | A | I | H | optional | restart | supported |
| `voice.policy.artifacts.storeTranscripts` | A | I | H | optional | restart | supported |
| `voice.policy.artifacts.storeSynthesizedAudio` | A | I | H | optional | restart | supported |
| `voice.policy.artifacts.retentionMaxArtifacts` | A | I | H | optional | restart | supported |
| `voice.policy.surfaces.<id>.enabled` | A | I | H | optional | restart | supported |
| `voice.policy.surfaces.<id>.input.modes[]` | A | I | H | optional | restart | supported |
| `voice.policy.surfaces.<id>.input.failureMode` | A | I | C | optional | restart | supported |
| `voice.policy.surfaces.<id>.output.modes[]` | A | I | H | optional | restart | supported |
| `voice.policy.surfaces.<id>.output.failureMode` | A | I | C | optional | restart | supported |
| `safety.pii.detect` | A | I | C | enabled by validator posture | restart | supported |
| `safety.pii.action` | A | I | C | detect | restart | supported |
| `safety.pii.deepScan` | A | I | C | optional | restart | supported |
| `safety.pii.allowlist[]` | A | I | C | optional | restart | supported |
| `safety.content.enabled` | A | I | C | true | restart | supported |
| `safety.content.categories.<id>.threshold` | A | I | C | 0.5 | restart | supported |
| `safety.content.categories.<id>.action` | A | I | C | block | restart | supported |
| `safety.content.deepScan` | A | I | C | optional | restart | supported |
| `safety.rails[].type` | A | I | C | required variant | restart | supported |
| `safety.rails[].block[]` | A | I | C | optional variant field | restart | supported |
| `safety.rails[].escalate[]` | A | I | C | optional variant field | restart | supported |
| `safety.rails[].competitors[]` | A | I | C | optional variant field | restart | supported |
| `safety.rails[].response` | A | I | C | optional variant field | restart | supported |
| `safety.rails[].triggers[]` | A | I | C | optional variant field | restart | supported |
| `safety.rails[].required[]` | A | I | C | optional variant field | restart | supported |
| `safety.rails[].forbid[]` | A | I | C | optional variant field | restart | supported |
| `runtime` | AS | I | C | `claude-code` | restart | supported by separate reader; converge Slice 9 |
| `provider.name` | AS | I | C | required for provider mode | restart | supported by separate reader |
| `provider.model` | AS | I | H | optional | restart | supported by separate reader |
| `provider.apiKeyEnv` | AS | I | C ref | optional | restart | supported by separate reader |
| `billing.budgetEndpoint` | AS | I | H | optional | restart | supported by separate reader |
| `billing.usageEndpoint` | AS | I | H | optional | restart | supported by separate reader |
| `billing.overBudgetMessage` | AS | I | M | optional | restart | supported by separate reader |
| `billing.headers.<key>` | AS | I | C ref | environment references resolved ephemerally | restart | supported by separate reader |
| `billing.tiers[]` | AS | I/E | H | runtime-mode contract | restart | supported; classification split Slice 9 |
| `events.webhook` | AS | I | H | optional | restart | supported by separate reader |
| `events.headers.<key>` | AS | I | C ref | optional | restart | supported by separate reader |
| `events.retryAttempts` | AS | I | H | emitter default 3 | restart | unreachable from YAML; Slice 9 |
| `events.retryBackoffMs` | AS | I | H | emitter default 1000 | restart | unreachable from YAML; Slice 9 |

## Gateway Configuration

Evidence:
[`gateway-loader.ts`](../../../packages/core/src/engine/gateway/gateway-loader.ts)
and the imported gateway domain contracts.

| Canonical property | Profile | Plane | Sensitivity / authority | Default | Activation | Disposition / transfer |
| --- | --- | --- | --- | --- | --- | --- |
| `port` | W | I | C | 4800; command may override | restart | supported; effective precedence projected Slice 2/9 |
| `apps[].name` | W | I | H | required unique | restart | supported |
| `apps[].config` | W | I | C ref | required path | restart | supported |
| `apps[].workspace` | W | I | H ref | optional path | restart | parsed but runtime consumer unproven; Slice 9 |
| `apps[].channels[].type` | W | I | C | required | restart | supported |
| `apps[].channels[].path` | W | I | C | optional | restart | supported |
| `apps[].channels[].phoneNumber` | W | I | M | optional | restart | duplicate check only; Slice 9 disposition |
| `apps[].channels[].botToken` | W | I | C | optional raw secret | restart | unreachable/unsafe; delete or replace with ref Slice 9 |
| `apps[].channels[].multiTenant` | W | I | C | optional | restart | supported |
| `apps[].channels[].verifyTokenEnv` | W | I | C ref | optional | restart | supported |
| `apps[].channels[].adminTokenEnv` | W | I | C ref | optional | restart | supported |
| `apps[].channels[].accessTokenEnv` | W | I | C ref | optional | restart | supported |
| `apps[].channels[].apiKeyEnv` | W | I | C ref | optional | restart | supported |
| `apps[].channels[].appSecretEnv` | W | I | C ref | optional | restart | supported |
| `apps[].channels[].publicMediaBaseUrlEnv` | W | I | H ref | optional | restart | supported |
| `apps[].channels[].publicMediaSigningSecretEnv` | W | I | C ref | optional | restart | supported |
| `apps[].channels[].allowedOrigins[]` | W | I | C | optional allow set | restart | supported |
| `observability.enabled` | W | I | M | true | restart | supported |
| `observability.exporter` | W | I | M | none | restart | supported |
| `observability.endpoint` | W | I | M | optional | restart | supported |
| `observability.serviceName` | W | I | L | optional | restart | supported |
| `observability.attributes.<key>` | W | I | M | optional | restart | supported; strict nested schema Slice 9 |
| `auth.algorithm` | W | I | C | validated | restart | supported |
| `auth.jwksUri` | W | I | C | optional | restart | supported |
| `auth.secretEnv` | W | I | C ref | optional | restart | supported |
| `auth.issuer` | W | I | C | optional | restart | supported |
| `auth.audience` | W | I | C | optional | restart | supported |
| `auth.clockToleranceSeconds` | W | I | H | optional | restart | supported |
| `mcp.enabled` | W | I | C | false | restart | supported |
| `mcp.path` | W | I | C | `/mcp` | restart | supported |
| `mcp.auth` | W | I | C ref | optional | restart | supported |
| `mcp.eval` | W | I | C ref | optional | restart | supported |
| `modelGateway.port` | W | I | C | required when present | restart | supported |
| `modelGateway.replay.ttlMs` | W | I | C | required | restart | supported |
| `modelGateway.replay.maxEntries` | W | I | C | required | restart | supported |
| `modelGateway.replay.hmacKeyEnv` | W | I | C ref | required | restart | supported |
| `modelGateway.principals[].tokenEnv` | W | I | C ref | required | restart | supported |
| `modelGateway.principals[].ingress` | W | I | C | required | restart | supported |
| `modelGateway.principals[].tenantId` | W | I | C | required | restart | supported |
| `modelGateway.principals[].applicationId` | W | I | C | required | restart | supported |
| `modelGateway.principals[].callerId` | W | I | C | required | restart | supported |
| `modelGateway.principals[].capabilityId` | W | I | C | required | restart | supported |
| `modelGateway.principals[].scopes[]` | W | I | C | authority set | restart | supported |
| `modelGateway.principals[].budgetEvidenceId` | W | E | H | evidence reference | restart | managed-evidence |
| `modelGateway.principals[].virtualModelIds[]` | W | I | C | admitted set | restart | supported |
| `modelGateway.principals[].nativeHarness` | W | I | C | optional | restart | supported |
| `modelGateway.virtualModels[].id` | W | I | H | unique | restart | supported |
| `modelGateway.virtualModels[].displayName` | W | I | L | optional | restart | supported |
| `modelGateway.virtualModels[].contextTokens` | W | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].outputTokens` | W | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].baseInstructions` | W | I | H | prompt authority | restart | supported |
| `modelGateway.virtualModels[].targetId` | W | I | C | physical target reference | restart | supported |
| `modelGateway.virtualModels[].capabilities[]` | W | E | H | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].deliberation.levels[]` | W | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].deliberation.defaultLevel` | W | I | M | optional | restart | supported |
| `modelGateway.virtualModels[].deliberation.supportsAdaptive` | W | E | M | capability evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].deliberation.evidenceRevision` | W | E | M | exact evidence | restart | managed-evidence |
| `modelGateway.virtualModels[].affinity.continuity` | W | I | H | required | restart | supported |
| `modelGateway.virtualModels[].affinity.scope` | W | I | H | optional | restart | supported |
| `modelGateway.virtualModels[].affinity.allowRebind` | W | I | H | optional | restart | supported |
| `modelGateway.surfaces.openAIResponses.maxBodyBytes` | W | I | H | required when surface exists | restart | supported |
| `modelGateway.surfaces.openAIResponses.maxConcurrentRequests` | W | I | H | required when surface exists | restart | supported |
| `modelGateway.surfaces.anthropicMessages.maxBodyBytes` | W | I | H | required when surface exists | restart | supported |
| `modelGateway.surfaces.anthropicMessages.maxConcurrentRequests` | W | I | H | required when surface exists | restart | supported |
| `modelGateway.codexComposite.maxQueuedRequests` | W | I | H | required when present | restart | supported |
| `modelGateway.codexComposite.queueTimeoutMs` | W | I | H | required when present | restart | supported |

## Derived `ResolvedKilnConfig` Residue

These fields are not additional durable configuration sources.

| Property | Source / consumer | Plane | Disposition |
| --- | --- | --- | --- |
| `provider` | legacy resolved scalar; native/session consumers | P | projection; remove or derive from target in Slice 1 |
| `model.default` | legacy resolved scalar; session consumers | P | projection; remove or derive from target in Slice 1 |
| `model.fallback[]` | no admitted global/project source proven | P | unreachable; delete in Slice 1 |
| `providers.<id>.apiKeyEnv` | retained by merge, no admitted source proven | P | unreachable; delete in Slice 1 |
| `managedAgents` | global config | P | supported projection |
| `modelTaskSuitability` | global config | P | supported projection |
| `deliberationPolicy` | global config | P | supported projection |
| `skillGeneration.enabled` | no admitted source proven | P | unreachable; delete in Slice 1 |
| `skillGeneration.model` | no admitted source proven | P | unreachable; delete in Slice 1 |
| `skillGeneration.complexityThreshold` | no admitted source proven | P | unreachable; delete in Slice 1 |
| `hooks` | global config | P | supported projection |
| `targetCatalog` | global config | P | supported projection |
| `authorityProfiles` | global config | P | supported projection |

## Writer Operations

| Operation | Current owner and behavior | Target lifecycle |
| --- | --- | --- |
| Global config mutation | CLI configuration mutation authority plus exact-byte `commitGlobalConfigBytes`; validation, revision CAS, lock, same-directory temporary file, atomic replace, invalid backup | complete in Slice 4; the unfenced object mutator is deleted and the authority is the only production global writer |
| Target creation/import and UI preferences | Typed `target.create`, `target.select`, and `native.import` operations; target evidence remains content-addressed under its own owner | complete in Slice 4; activation and reconciliation settle honestly through execution-route or native-permission readback |
| Project init/config set | `kiln config set` now edits the document tree through the mutation authority with a typed result; `writeKilnYaml` whole-object serialization remains only in `kiln init` | done for `config set`; `kiln init` transfers to Slice 5 adoption |
| Project proposal/approval/apply | One config mutation authority for both scopes; base-revision fence, path-scoped lock, atomic replace, write-once settlement, honest terminal outcome | done in Slice 4; multi-path atomicity still unproven because each operation writes one path |
| App/gateway init | CLI templates write whole files | replace only when their Slice 9 schemas and readers admit generated output |
| App cron mutation | CLI rewrites `app.yaml` through generic serialization | replace with app-owned AST mutation in Slice 9 |
| Native/repo projection | CLI projection owners write generated artifacts and drift state | remain projections; bind canonical revision to projection/activation evidence in Slices 2 and 4 |

## Transferred Blockers

| Blocker | Owner and target | Closure evidence |
| --- | --- | --- |
| Project unchecked/duplicated structural boundary and derived residue | CLI project schema owner, Slice 1 | one TypeBox reader/inferred type; strict unknown/malformed tests; old type/validator and unreachable residue deleted |
| Effective value provenance and command/runtime overrides | Gateway Contracts plus CLI status owner, Slice 2 | every surface returns the same source, override chain, health, revision, authority, and activation |
| Intent mixed with target, context, and policy evidence | execution-routing/context owners, Slice 3 | managed evidence moves to named stores or is explicitly justified as intent; exact revisions remain referenced |
| Divergent writer and activation lifecycles | CLI configuration application-port owner, Slice 4 | typed mutation result distinguishes rejected, committed, reconciliation-failed, and rolled-back; activation tests per field |
| Init emits `apps[].path`/`modeB` while gateway requires `apps[].config` | CLI init writer plus Core gateway reader, Slice 9 | generated gateway bytes pass the production reader |
| App root split among `AppLoader`, runtime-mode, billing, and events readers | Core app structural/graph owner, Slice 9 | one strict structural boundary delegates named semantic admission; no silent unknown roots |
| Declared-but-unreachable app/domain properties and duplicate app/gateway route intent | owning Core knowledge/eval/tool/voice/safety/gateway domains, Slice 9 | each property is mapped and consumed, or deleted with examples/docs/tests aligned |
| Gateway nested unknowns, raw `botToken`, and numeric `NaN` mapping | Core gateway schema owner, Slice 9 | strict schema rejects unknown/malformed fields and persists only secret references |
| Per-harness preventive enforcement fidelity | native harness integration owner, security workstream before global migration | side-effect-negative fixtures prove prevention or route admission rejects |

Operator-specific files, installed package copies, generated `dist`, and live
native harnesses were intentionally not treated as configuration authority.
Dynamic external consumers remain unproven, but Kiln has no external consumers
under the adopted project context. Those limits do not reopen Slice 0; later
slices must update this ledger when they replace a property owner or
disposition.
