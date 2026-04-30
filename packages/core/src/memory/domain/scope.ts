export const MEMORY_SCOPE_KINDS = [
  "user",
  "agent",
  "team",
  "project",
  "org",
  "app",
  "tenant",
  "session",
] as const;

export type MemoryScopeKind = typeof MEMORY_SCOPE_KINDS[number];

export interface MemoryScope {
  readonly kind: MemoryScopeKind;
  readonly id: string;
}

export function defineMemoryScope(input: { readonly kind: string; readonly id: string }): MemoryScope {
  if (!isMemoryScopeKind(input.kind)) {
    throw new Error(`Unsupported memory scope kind: ${input.kind}`);
  }

  const id = input.id.trim();
  if (id.length === 0) {
    throw new Error("Memory scope id is required");
  }

  return {
    kind: input.kind,
    id,
  };
}

export function isMemoryScopeKind(value: string): value is MemoryScopeKind {
  return (MEMORY_SCOPE_KINDS as readonly string[]).includes(value);
}
