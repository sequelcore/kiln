import type {
  OperatorManagedEconomicAmount,
  OperatorManagedEconomicChildConsumption,
} from "./frames.js";

/** Shared operator rendering of a secret-free economic amount. */
export function formatOperatorManagedEconomicAmount(
  amount: OperatorManagedEconomicAmount,
): string {
  const scheme = amount.scheme.kind === "currency"
    ? amount.scheme.currency
    : amount.scheme.kind === "credit"
      ? amount.scheme.creditSchemeId
      : "unit";
  return `${amount.atoms}e-${amount.scale} ${amount.unit} ${scheme}`;
}

/** Shared operator rendering of per-child usage, preserving child identity and amounts. */
export function formatOperatorManagedEconomicChildConsumption(
  children: readonly OperatorManagedEconomicChildConsumption[],
): string {
  return children.map((child) => {
    const units = child.units?.map(formatOperatorManagedEconomicAmount).join(",") ?? "none";
    const settled = child.settledAmount
      ? ` settled=${formatOperatorManagedEconomicAmount(child.settledAmount)}`
      : "";
    return `${child.childId}[${units}${settled}]`;
  }).join(",");
}
