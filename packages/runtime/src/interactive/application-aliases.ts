export type ApplicationAliasMap = Readonly<Record<string, readonly string[]>>;

export function normalizeApplicationList(value: readonly string[] | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    const normalized = item.trim();
    if (normalized && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

export function normalizeApplicationAliases(value: ApplicationAliasMap | undefined): ApplicationAliasMap {
  if (!value) {
    return {};
  }
  const out: Record<string, readonly string[]> = {};
  for (const [key, aliases] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedAliases = normalizeApplicationList(aliases);
    if (normalizedKey && normalizedAliases.length > 0) {
      out[normalizedKey] = normalizedAliases;
    }
  }
  return out;
}

export function isApplicationAliasMatch(
  left: string | undefined,
  right: string,
  configuredAliases: ApplicationAliasMap,
): boolean {
  if (!left) {
    return false;
  }
  const leftAliases = applicationAliases(left, configuredAliases);
  const rightAliases = applicationAliases(right, configuredAliases);
  return leftAliases.some((alias) => rightAliases.includes(alias));
}

function applicationAliases(value: string, configuredAliases: ApplicationAliasMap): readonly string[] {
  const normalized = value.toLocaleLowerCase("en-US").trim();
  for (const [name, aliases] of Object.entries(configuredAliases)) {
    const group = normalizeApplicationList([name, ...aliases]).map((alias) => alias.toLocaleLowerCase("en-US"));
    if (group.includes(normalized)) {
      return group;
    }
  }
  if (normalized === "calculator" || normalized === "calculadora" || normalized === "calculatorapp" || normalized === "calc") {
    return ["calculator", "calculadora", "calculatorapp", "calc", "applicationframehost"];
  }
  return [normalized];
}
