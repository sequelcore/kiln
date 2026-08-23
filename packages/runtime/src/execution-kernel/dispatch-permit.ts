/**
 * Process-local capability returned only by a successful action fence.
 *
 * The capability carries no reconstructable DTO identity. A copied reference
 * shares the consumed state and cannot authorize a second adapter call.
 */
const DISPATCH_PERMIT_TOKEN: unique symbol = Symbol("kiln-governed-one-round-dispatch-permit");

class DispatchPermit {
  #consumed = false;

  constructor(token: typeof DISPATCH_PERMIT_TOKEN) {
    if (token !== DISPATCH_PERMIT_TOKEN) throw new TypeError("Invalid model dispatch permit construction token.");
  }

  consume(): void {
    if (this.#consumed) throw new Error("The model dispatch permit has already been consumed.");
    this.#consumed = true;
  }
}

/** Opaque capability type; only the module-local factory can create one. */
export type GovernedOneRoundDispatchPermit = DispatchPermit;

/** Internal construction hook used by workload claim authorities. */
export function createGovernedOneRoundDispatchPermit(): GovernedOneRoundDispatchPermit {
  return new DispatchPermit(DISPATCH_PERMIT_TOKEN);
}
