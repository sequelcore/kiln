import { estimateTextTokens } from "./projected-context.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";

export type EffectivePromptComponentScope = "static" | "dynamic" | "deferred";

export interface EffectivePromptComponentProvenance {
  readonly source: string;
  readonly contextBlockId?: string;
  readonly contextSource?: string;
  readonly auditDecision?: "admitted" | "deferred";
}

interface EffectivePromptComponentBase {
  readonly id: string;
  readonly revision: string;
  readonly scope: EffectivePromptComponentScope;
  readonly estimatedTokens: number;
  readonly provenance: EffectivePromptComponentProvenance;
}

export interface EffectivePromptContentComponent extends EffectivePromptComponentBase {
  readonly scope: "static" | "dynamic";
  readonly content: string;
}

export interface DeferredEffectivePromptComponent extends EffectivePromptComponentBase {
  readonly scope: "deferred";
}

export type EffectivePromptComponent =
  | EffectivePromptContentComponent
  | DeferredEffectivePromptComponent;

export interface EffectivePromptComponentInput {
  readonly id: string;
  readonly revision: string;
  readonly scope: "static" | "dynamic";
  readonly content: string;
  readonly estimatedTokens?: number;
  readonly provenance: EffectivePromptComponentProvenance;
}

export interface DeferredEffectivePromptComponentInput {
  readonly id: string;
  readonly revision: string;
  readonly scope: "deferred";
  readonly estimatedTokens?: number;
  readonly provenance: EffectivePromptComponentProvenance;
}

export interface EffectivePromptManifestInput {
  readonly components: readonly (
    | EffectivePromptComponentInput
    | DeferredEffectivePromptComponentInput
  )[];
}

export interface EffectivePromptManifest {
  readonly version: "v1";
  readonly components: readonly EffectivePromptComponent[];
  readonly finalPrompt: string;
  readonly finalPromptHash: string;
  readonly estimatedTokens: number;
}

export interface EffectivePromptComponentEvidence {
  readonly id: string;
  readonly revision: string;
  readonly scope: EffectivePromptComponentScope;
  readonly estimatedTokens: number;
  readonly provenance: EffectivePromptComponentProvenance;
}

export interface EffectivePromptEvidence {
  readonly version: "v1";
  readonly components: readonly EffectivePromptComponentEvidence[];
  readonly finalPromptHash: string;
  readonly estimatedTokens: number;
}

function validateComponents(
  components: readonly (
    | EffectivePromptComponentInput
    | DeferredEffectivePromptComponentInput
  )[],
): void {
  const ids = new Set<string>();

  for (const component of components) {
    if (component.id.trim() === "") {
      throw new Error("Effective prompt component id must not be empty.");
    }
    if (component.revision.trim() === "") {
      throw new Error("Effective prompt component revision must not be empty.");
    }
    if (ids.has(component.id)) {
      throw new Error(`Effective prompt component id is duplicated: ${component.id}`);
    }
    if (
      component.estimatedTokens !== undefined
      && (!Number.isInteger(component.estimatedTokens) || component.estimatedTokens < 0)
    ) {
      throw new Error("Effective prompt component estimatedTokens must be a non-negative integer.");
    }
    ids.add(component.id);
  }
}

function normalizeComponents(
  components: readonly (
    | EffectivePromptComponentInput
    | DeferredEffectivePromptComponentInput
  )[],
): readonly EffectivePromptComponent[] {
  validateComponents(components);
  return components.map((component) => {
    const estimatedTokens = component.estimatedTokens
      ?? (component.scope === "deferred" ? 0 : estimateTextTokens(component.content));
    return component.scope === "deferred"
      ? { ...component, estimatedTokens }
      : { ...component, estimatedTokens, content: component.content };
  });
}

function renderEffectivePrompt(components: readonly EffectivePromptComponent[]): string {
  return components
    .filter((component): component is EffectivePromptContentComponent => component.scope !== "deferred")
    .map((component) => component.content)
    .join("");
}

function redactProvenance(
  provenance: EffectivePromptComponentProvenance,
): EffectivePromptComponentProvenance {
  return {
    source: sha256ContentIdentity(provenance.source),
    ...(provenance.contextBlockId === undefined
      ? {}
      : { contextBlockId: sha256ContentIdentity(provenance.contextBlockId) }),
    ...(provenance.contextSource === undefined
      ? {}
      : { contextSource: sha256ContentIdentity(provenance.contextSource) }),
    ...(provenance.auditDecision === undefined
      ? {}
      : { auditDecision: provenance.auditDecision }),
  };
}

/**
 * Creates the exact provider-ready prompt and its redacted replay evidence in one pass.
 */
export function buildEffectivePromptManifest(
  input: EffectivePromptManifestInput,
): EffectivePromptManifest {
  const components = normalizeComponents(input.components);
  const finalPrompt = renderEffectivePrompt(components);

  return {
    version: "v1",
    components,
    finalPrompt,
    finalPromptHash: sha256ContentIdentity(finalPrompt),
    estimatedTokens: estimateTextTokens(finalPrompt),
  };
}

export function toEffectivePromptEvidence(
  manifest: EffectivePromptManifest,
): EffectivePromptEvidence {
  return {
    version: manifest.version,
    components: manifest.components.map(({ id, revision, scope, estimatedTokens, provenance }) => ({
      id: sha256ContentIdentity(id),
      revision: sha256ContentIdentity(revision),
      scope,
      estimatedTokens,
      provenance: redactProvenance(provenance),
    })),
    finalPromptHash: manifest.finalPromptHash,
    estimatedTokens: manifest.estimatedTokens,
  };
}
