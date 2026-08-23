type FetchImplementation = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

/**
 * Complete Bun's fetch function contract while preserving the concrete mock
 * type, so tests can inspect calls without casting away their evidence.
 */
export function createTestFetch<TImplementation extends FetchImplementation>(
  implementation: TImplementation,
): TImplementation & typeof fetch {
  return Object.assign(implementation, {
    preconnect(_url: string | URL): void {},
  });
}
