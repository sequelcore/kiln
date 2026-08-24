import { resolveGlobalConfigPath } from "../config/global-config.js";
import { readProjectAdoption } from "./project-adoption-manifest.js";
import { resolveProjectRoot } from "./project-root-resolver.js";
import { readRuntimeConfigurationRevision } from "./runtime-configuration-revision.js";
import {
  type ProjectStateBinding,
  type ProjectStateRootOptions,
  resolveProjectStateBinding,
} from "./project-state-root.js";

export type TrustedWorkspaceRejectionReason = "invalid-cwd" | "unadopted" | "unsafe-adoption";

export type TrustedWorkspaceResolution =
  | {
      readonly status: "resolved";
      readonly canonicalRoot: string;
      readonly projectRuntimeId: `krp_${string}`;
      readonly projectStateRoot: string;
      readonly adoptionRevision: `sha256:${string}`;
      /**
       * Exact global configuration CAS revision used by the process-scoped
       * managed-account composition. This remains an internal CLI value; the
       * Gateway/Runtime binding only carries compositionRevision.
       */
      readonly globalConfigRevision: "absent" | `sha256:${string}`;
      readonly compositionRevision: `sha256:${string}`;
    }
  | {
      readonly status: "rejected";
      readonly reason: TrustedWorkspaceRejectionReason;
    };

export interface TrustedProcessContext {
  cwd(): string;
}

export interface TrustedWorkspaceOptions extends ProjectStateRootOptions {
  readonly userHome?: string;
  readonly globalConfigPath?: string;
}

/**
 * Resolve one adopted private project from the native process CWD. No request,
 * environment, model, or repository-local `.kiln` marker participates.
 */
export function resolveTrustedWorkspace(
  processContext: TrustedProcessContext = process,
  options: TrustedWorkspaceOptions = {},
): TrustedWorkspaceResolution {
  let binding: ProjectStateBinding;
  try {
    const root = resolveProjectRoot({ cwd: processContext.cwd(), userHome: options.userHome });
    binding = resolveProjectStateBinding(root.rootPath, options);
  } catch {
    return rejected("invalid-cwd");
  }

  const adoption = readProjectAdoption(binding);
  if (adoption.status !== "adopted") {
    return rejected(adoption.reason === "missing" ? "unadopted" : "unsafe-adoption");
  }

  let globalConfigRevision: "absent" | `sha256:${string}`;
  let compositionRevision: `sha256:${string}`;
  try {
    const revision = readRuntimeConfigurationRevision(binding.canonicalRoot, {
      projectStateBinding: binding,
      globalConfigPath: options.globalConfigPath ?? resolveGlobalConfigPath(),
    });
    const globalRevision = revision.revisions.global;
    if (globalRevision === undefined || !isCanonicalRevision(globalRevision)) return rejected("unsafe-adoption");
    if (!isSha256Revision(revision.revisionSetId)) return rejected("unsafe-adoption");
    globalConfigRevision = globalRevision;
    compositionRevision = revision.revisionSetId;
  } catch {
    return rejected("unsafe-adoption");
  }

  return {
    status: "resolved",
    canonicalRoot: binding.canonicalRoot,
    projectRuntimeId: binding.projectRuntimeId,
    projectStateRoot: binding.projectStateRoot,
    adoptionRevision: adoption.adoptionRevision,
    globalConfigRevision,
    compositionRevision,
  };
}

function isCanonicalRevision(value: string): value is "absent" | `sha256:${string}` {
  return value === "absent" || isSha256Revision(value);
}

function isSha256Revision(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function rejected(reason: TrustedWorkspaceRejectionReason): TrustedWorkspaceResolution {
  return { status: "rejected", reason };
}
