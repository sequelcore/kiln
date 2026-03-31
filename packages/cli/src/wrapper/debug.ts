const PREFIX = "[kiln/wrapper]";

export function debug(message: string, ...args: unknown[]): void {
  if (process.env.NODE_ENV === "test") return;
  console.debug(`${PREFIX} ${message}`, ...args);
}
