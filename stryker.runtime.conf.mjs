/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ["packages/runtime/src/execution-kernel/runtime-media-action-claim.ts"],
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: {
    configFile: "packages/runtime/vitest.mutation.config.ts",
    related: true,
  },
  coverageAnalysis: "perTest",
  concurrency: "50%",
  incremental: false,
  // Stryker 10 still calls a TypeScript API removed in TypeScript 7 while
  // rewriting tsconfig files. Relative project paths remain valid in its
  // nested sandbox, so deliberately skip that optional rewrite.
  tsconfigFile: ".stryker-no-tsconfig.json",
  reporters: ["clear-text"],
  thresholds: { break: null },
  // Mutants commonly violate TypeScript types. The canonical `typecheck` gate
  // remains separate and mandatory; this pilot measures behavioral detection.
  disableTypeChecks: "packages/runtime/src/execution-kernel/runtime-media-action-claim.ts",
};
