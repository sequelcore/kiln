export const FRONTEND_BENCHMARK_CASE_IDS = [
  "modal-focus",
  "tabs-keyboard",
  "form-errors",
  "disclosure",
  "sortable-table",
  "menu-button",
  "live-status",
  "pagination",
] as const;

export type FrontendBenchmarkCaseId = typeof FRONTEND_BENCHMARK_CASE_IDS[number];

export function requireFrontendBenchmarkCaseId(value: unknown): FrontendBenchmarkCaseId {
  if (typeof value !== "string" || !FRONTEND_BENCHMARK_CASE_IDS.includes(value as FrontendBenchmarkCaseId)) {
    throw new Error("Frontend benchmark case must identify an admitted v2 case.");
  }
  return value as FrontendBenchmarkCaseId;
}
