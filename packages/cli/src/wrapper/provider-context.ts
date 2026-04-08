export interface ProviderContextTrackerConfig {
  readonly maxContextTokens: number;
  readonly compactionThreshold: number;
  readonly initialTokens?: number;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${label} must be > 0 and <= 1`);
  }
}

export class ProviderContextTracker {
  private totalTokensValue: number;
  private readonly maxContextTokensValue: number;
  private readonly compactionThresholdValue: number;
  private readonly compactionThresholdTokensValue: number;

  constructor(config: ProviderContextTrackerConfig) {
    assertPositiveInteger(config.maxContextTokens, "maxContextTokens");
    assertUnitInterval(config.compactionThreshold, "compactionThreshold");
    const initialTokens = config.initialTokens ?? 0;
    assertNonNegativeInteger(initialTokens, "initialTokens");

    this.maxContextTokensValue = config.maxContextTokens;
    this.compactionThresholdValue = config.compactionThreshold;
    this.compactionThresholdTokensValue = Math.floor(
      this.maxContextTokensValue * this.compactionThresholdValue,
    );
    this.totalTokensValue = initialTokens;
  }

  get totalTokens(): number {
    return this.totalTokensValue;
  }

  get maxContextTokens(): number {
    return this.maxContextTokensValue;
  }

  get compactionThreshold(): number {
    return this.compactionThresholdValue;
  }

  get compactionThresholdTokens(): number {
    return this.compactionThresholdTokensValue;
  }

  update(inputTokens = 0, outputTokens = 0): number {
    assertNonNegativeInteger(inputTokens, "inputTokens");
    assertNonNegativeInteger(outputTokens, "outputTokens");
    this.totalTokensValue += inputTokens + outputTokens;
    return this.totalTokensValue;
  }

  shouldTriggerCompaction(pendingTokens = 0): boolean {
    assertNonNegativeInteger(pendingTokens, "pendingTokens");
    return this.totalTokensValue + pendingTokens >= this.compactionThresholdTokensValue;
  }

  reset(tokens = 0): void {
    assertNonNegativeInteger(tokens, "tokens");
    this.totalTokensValue = tokens;
  }
}
