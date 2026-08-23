// Engine composite: Router -- fallback team selection

/** Selects the fallback team for incoming requests */
export interface Router {
  readonly fallback: string;
}

/** Validation error for router configuration */
export interface RouterValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a Router composite configuration */
export function validateRouter(router: Router): RouterValidationError[] {
  const errors: RouterValidationError[] = [];

  if (!router.fallback || typeof router.fallback !== "string") {
    errors.push({ field: "fallback", message: "must be a non-empty string" });
  }
  return errors;
}
