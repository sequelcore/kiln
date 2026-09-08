import type { DeepReadonly } from "./deep-readonly.js";
import { Type, type Static } from "@sinclair/typebox";

export const externalSkillCatalogPolicySchema = Type.Object(
  {
    version: Type.Readonly(Type.Literal(2)),
    harnesses: Type.Readonly(
      Type.Object(
        {
          codex: Type.Readonly(
            Type.Object(
              {
                keepImplicit: Type.Readonly(
                  Type.Array(
                    Type.Object(
                      {
                        sourceId: Type.Readonly(
                          Type.String({
                            minLength: 1,
                            pattern: "\\S",
                            description:
                              "Exact source ID from kiln skill review. Package approval is stored separately.",
                          }),
                        ),
                      },
                      { additionalProperties: false },
                    ),
                  ),
                ),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    description: "External skill selections. Use kiln skill review to approve their contents, then kiln sync to apply.",
    "x-kiln-semantic-owner": "skill-catalog",
    "x-kiln-authority-impact": "authority-bearing",
    "x-kiln-activation": "reconcile",
  },
);

export type KilnExternalCatalogPolicy = DeepReadonly<Static<typeof externalSkillCatalogPolicySchema>>;
