import { z } from "zod";

export const COMMUNICATION_RESPONSE_DETAILS = [
  "provider-default",
  "concise",
  "standard",
  "detailed",
] as const;

export const COMMUNICATION_INTERACTION_BEHAVIORS = [
  "audience-calibrated",
  "findings-first",
  "next-action-explicit",
  "outcome-first",
  "plain-language",
  "state-visible",
] as const;

export const COMMUNICATION_REQUIRED_CONTENT = [
  "approval-requirement",
  "citation",
  "decision",
  "failure",
  "finding",
  "next-action",
  "residual-risk",
  "verification",
  "warning",
] as const;

const portableIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const contractReference = z.object({
  id: portableIdentifier,
  revision: portableIdentifier,
}).strict();

const interactionProfile = z.object({
  id: portableIdentifier,
  revision: portableIdentifier,
  behaviors: z.array(z.enum(COMMUNICATION_INTERACTION_BEHAVIORS)).min(1),
}).strict().superRefine((profile, context) => {
  if (new Set(profile.behaviors).size !== profile.behaviors.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "interaction profile behaviors must be unique" });
  }
});

export const CommunicationIntentSchema = z.object({
  responseDetail: z.enum(COMMUNICATION_RESPONSE_DETAILS).optional(),
  interactionProfile: interactionProfile.optional(),
  locale: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  requiredContent: z.array(z.enum(COMMUNICATION_REQUIRED_CONTENT)).optional(),
  artifactContract: contractReference.optional(),
  responseSkills: z.array(contractReference).optional(),
  onUnsupported: z.enum(["deny", "omit"]).optional(),
}).strict();

export type CommunicationIntentWire = z.infer<typeof CommunicationIntentSchema>;
