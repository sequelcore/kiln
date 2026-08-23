// Channel adapters -- multi-platform message delivery

export { formatForChannel, toWhatsAppFormat } from "./message-formatter.js";
export type { ChannelConfig, ChannelStatus, IdentityMapping, IdentityResolver } from "./types.js";
export { InMemoryIdentityResolver } from "./types.js";
export { WebChannel } from "./web-channel.js";
export type { WebSocketLike } from "./web-channel.js";
export {
  ChannelEgressClaimedError,
  ChannelEgressPreDispatchCancellationError,
  assertCanonicalSha256Id,
  channelEgressDigest,
  defineChannelEgressActionClaim,
  dispatchChannelEgress,
  prepareChannelEgressActionClaim,
} from "./channel-egress-action-claim.js";
export type {
  ChannelEgressActionClaim,
  ChannelEgressActionClaimPermit,
  ChannelEgressActionClaimContext,
  ChannelEgressActionClaimId,
  ChannelEgressActionClaimRecord,
  ChannelEgressActionClaimStore,
  ChannelEgressActionDigest,
  ChannelEgressClaimStatus,
  ChannelEgressDispatchInput,
  ChannelEgressActionClaimSettlement,
  ChannelEgressAdmissionReadInput,
} from "./channel-egress-action-claim.js";
