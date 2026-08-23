import type { VoiceConfig } from "@kilnai/core";
import { KilnYamlError } from "../../../kiln-yaml.js";
import { validateAgentScopeInheritance } from "../../../kiln-yaml-types.js";
import { readMcpConfigurationSource } from "../../mcp-config.js";
import {
  GLOBAL_CONFIG_SCHEMA,
  CANONICAL_GLOBAL_CONFIG_VERSION,
  parseGlobalConfigStructure,
  type KilnGlobalConfig,
} from "../../global-config-schema.js";
import { resolveGlobalConfigPath } from "../path.js";
import {
  validateAuthorityProfiles,
  validateManagedAgents,
  validateManagedTargetReferences,
} from "./authority.js";
import {
  validateTargetCatalog,
  validateTargetRouting,
} from "./execution-routing.js";
import {
  validateDeliberationPolicy,
  validateModelTaskSuitability,
} from "./model-policy.js";
import {
  validateComponents,
  validateGlobalWeb,
  validatePermissionCeiling,
  validateSessionTurnBudget,
} from "./global-settings.js";
import { validateEngines, validateGlobalModelGateway } from "./harness-settings.js";
import {
  validateCommunication,
  validateGlobalUi,
  validateIdentity,
  validateOperatorVoice,
} from "./operator-preferences.js";
import { validateSkills } from "./skill-policy.js";
import { validateGlobalVerification } from "./verification.js";
import { validateWorkGovernance } from "./work-governance.js";
import {
  isRecord,
  rejectUnknownFields,
  validateRecordField,
  validateStringArray,
} from "./shared.js";

/** Composes structural, owner-specific, and cross-resource admission. */
export function validateGlobalConfig(config: unknown): asserts config is KilnGlobalConfig {
  if (!isRecord(config)) {
    throw new KilnYamlError("Global config must be an object");
  }
  if (config.version !== CANONICAL_GLOBAL_CONFIG_VERSION) {
    throw new KilnYamlError(
      `Global config version must be "${CANONICAL_GLOBAL_CONFIG_VERSION}". Recreate the canonical config through an explicit adoption flow.`,
    );
  }
  rejectUnknownFields(config, Object.keys(GLOBAL_CONFIG_SCHEMA.properties), "global config");
  validateRecordField(config, "identity");
  validateRecordField(config, "workGovernance");
  validateRecordField(config, "engines");
  validateRecordField(config, "targetCatalog");
  validateRecordField(config, "targetRouting");
  validateRecordField(config, "permissions");
  validateAgentScopeInheritance(config.permissions, "permissions");
  validateRecordField(config, "permissionCeiling");
  validateRecordField(config, "mcp");
  validateRecordField(config, "hooks");
  validateRecordField(config, "managedAgents");
  validateRecordField(config, "deliberationPolicy");
  validateRecordField(config, "communication");
  validateRecordField(config, "web");
  validateRecordField(config, "verification");
  validateRecordField(config, "ui");
  validateRecordField(config, "skills");
  validateRecordField(config, "components");
  validateRecordField(config, "operatorVoice");
  validateRecordField(config, "modelGateway");
  validateIdentity(config.identity);
  validateStringArray(config.activeInstructionProfiles, "activeInstructionProfiles");
  validateWorkGovernance(config.workGovernance);
  validateEngines(config.engines);
  validatePermissionCeiling(config.permissionCeiling);
  validateTargetCatalog(config.targetCatalog);
  validateTargetRouting(config.targetRouting, config.targetCatalog);
  validateAuthorityProfiles(config.authorityProfiles, config.operatorVoice as VoiceConfig | undefined);
  validateSessionTurnBudget(config.sessionTurnBudget);
  validateComponents(config.components);
  validateOperatorVoice(config.operatorVoice);
  validateManagedAgents(config.managedAgents, config.operatorVoice as VoiceConfig | undefined);
  validateModelTaskSuitability(config.modelTaskSuitability);
  validateDeliberationPolicy(config.deliberationPolicy);
  validateCommunication(config.communication, "communication", "global");
  validateSkills(config.skills);
  validateGlobalWeb(config.web);
  validateGlobalVerification(config.verification);
  validateGlobalUi(config.ui, config.targetCatalog);
  validateGlobalModelGateway(config.modelGateway);
  validateManagedTargetReferences(config.managedAgents, config.targetCatalog, config.authorityProfiles);
  readMcpConfigurationSource({
    value: config.mcp,
    scope: "global",
    sourcePath: resolveGlobalConfigPath(),
  });
  parseGlobalConfigStructure(config, resolveGlobalConfigPath());
}
