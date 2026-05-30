export interface ManagedAgentWorkspaceReadScope {
  readonly allowedPaths: readonly string[];
  readonly deniedPaths: readonly string[];
}

export interface ManagedAgentReadAuthority {
  readonly workspace: ManagedAgentWorkspaceReadScope;
}

export function defineManagedAgentReadAuthority(input: ManagedAgentReadAuthority): ManagedAgentReadAuthority {
  return {
    workspace: {
      allowedPaths: input.workspace.allowedPaths.map((path) =>
        requireText(path, "Managed read workspace path is required")
      ),
      deniedPaths: input.workspace.deniedPaths.map((path) =>
        requireText(path, "Managed denied read workspace path is required")
      ),
    },
  };
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
