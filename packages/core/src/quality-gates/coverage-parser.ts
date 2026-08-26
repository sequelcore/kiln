const PATTERNS: readonly RegExp[] = [
  // pytest-cov: TOTAL    500    100    80%
  /TOTAL\s+\d+\s+\d+\s+(\d+)%/,
  // Jest/Vitest: All files | 85.5 | 90 | 80 | 87.3
  /All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/,
  // Go: coverage: 92.5% of statements
  /coverage:\s*([\d.]+)%/,
  // JaCoCo: Total...80%
  /Total.*?(\d+)%/,
  // Generic: 80% coverage / 80% covered
  /(\d+(?:\.\d+)?)\s*%\s*(?:coverage|covered)/,
];

export function parseCoverageFromOutput(output: string): number | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(output);
    if (match?.[1]) {
      return parseFloat(match[1]);
    }
  }
  return null;
}

export function checkCoverage(
  output: string,
  threshold: number,
): { passed: boolean; coverage: number | null } {
  const coverage = parseCoverageFromOutput(output);
  if (coverage === null) {
    return { passed: false, coverage: null };
  }
  return { passed: coverage >= threshold, coverage };
}
