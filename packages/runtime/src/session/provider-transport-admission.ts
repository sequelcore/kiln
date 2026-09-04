import type { ProviderRequestIdentity, ProviderTransportAdmission } from "@kilnai/core";

export class RuntimeProviderTransportBudgetExceededError extends Error {
  override readonly name = "RuntimeProviderTransportBudgetExceededError";
}

/** One shareable hard fence for physical provider transport attempts. */
export class RuntimeProviderTransportBudgetAuthority implements ProviderTransportAdmission {
  private admitted = 0;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError("Physical provider request limit must be a positive safe integer.");
    }
  }

  admit(_identity?: ProviderRequestIdentity): void {
    if (this.admitted >= this.limit) {
      throw new RuntimeProviderTransportBudgetExceededError(
        `Physical provider request budget ${this.admitted}/${this.limit} is exhausted.`,
      );
    }
    this.admitted += 1;
  }

  snapshot(): { readonly admitted: number; readonly limit: number; readonly remaining: number } {
    return Object.freeze({
      admitted: this.admitted,
      limit: this.limit,
      remaining: this.limit - this.admitted,
    });
  }
}
