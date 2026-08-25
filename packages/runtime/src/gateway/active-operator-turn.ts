export interface ActiveOperatorTurn {
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  settle(): void;
}

export function createActiveOperatorTurn(): ActiveOperatorTurn {
  const controller = new AbortController();
  let settle = (): void => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { controller, settled, settle };
}

export async function abortAndAwaitOperatorTurns(turns: Iterable<ActiveOperatorTurn>): Promise<void> {
  const active = [...turns];
  for (const turn of active) {
    turn.controller.abort("Operator gateway shutdown requested.");
  }
  await Promise.all(active.map((turn) => turn.settled));
}
