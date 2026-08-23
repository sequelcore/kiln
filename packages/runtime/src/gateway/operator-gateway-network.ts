export const LOCAL_OPERATOR_GATEWAY_HOST = "127.0.0.1" as const;

export function localOperatorGatewayHttpOrigin(port: number): string {
  return `http://${LOCAL_OPERATOR_GATEWAY_HOST}:${port}`;
}

export function localOperatorGatewayHttpUrl(port: number, path: string): string {
  return `${localOperatorGatewayHttpOrigin(port)}${path}`;
}

export function localOperatorGatewayWebSocketUrl(port: number, path: string): string {
  return `ws://${LOCAL_OPERATOR_GATEWAY_HOST}:${port}${path}`;
}

export function parseExternalGuiOrigin(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("External GUI origin must be an exact loopback HTTP origin.");
  }

  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== LOCAL_OPERATOR_GATEWAY_HOST ||
    parsed.port.length === 0 ||
    parsed.origin !== value ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("External GUI origin must be an exact loopback HTTP origin.");
  }

  return parsed.origin;
}
