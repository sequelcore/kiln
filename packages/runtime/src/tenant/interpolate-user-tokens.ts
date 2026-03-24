import type { UserContext } from "@kilnai/core";

/**
 * Resolves {{user.*}} tokens in a template string using the provided UserContext.
 * Unknown keys resolve to empty string (fail-open).
 * If userContext is undefined, the template is returned unchanged.
 */
export function interpolateUserTokens(template: string, userContext: UserContext | undefined): string {
  if (!userContext) return template;
  return template.replace(/\{\{user\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(userContext, key) ? (userContext[key] ?? "") : "";
  });
}
