import type {
  KilnAuthorityProfileConfig,
  KilnManagedAgentExternalRuntimeAttachmentConfig,
  KilnManagedAgentRemoteHarnessConfig,
} from "../kiln-yaml-types.js";

interface ResolvedManagedTargetCommon {
  readonly id: string;
  readonly authorityProfiles: readonly KilnAuthorityProfileConfig[];
}

/** Internal resolved projection. Durable configuration uses targetCatalog + authorityProfiles. */
export type ResolvedManagedTargetConfig =
  | (ResolvedManagedTargetCommon & { readonly kind: "direct" })
  | (ResolvedManagedTargetCommon & {
    readonly kind: "harness";
    readonly provider: string;
    readonly model: string;
    readonly remoteHarness?: KilnManagedAgentRemoteHarnessConfig;
    readonly externalRuntimeAttachment?: KilnManagedAgentExternalRuntimeAttachmentConfig;
  });
