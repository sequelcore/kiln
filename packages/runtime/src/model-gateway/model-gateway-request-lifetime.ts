export interface ModelGatewayRequestLifetimeControl {
  timeout(request: Request, seconds: number): void;
}

export type ModelGatewayListenerFetch = (
  request: Request,
  server: ModelGatewayRequestLifetimeControl,
) => Response | Promise<Response>;

const pendingLifetimeClaims = new WeakMap<Request, () => void>();

export function ownModelGatewayRequestLifetime(
  listenerFetch: (request: Request) => Response | Promise<Response>,
): ModelGatewayListenerFetch {
  return async (request, server) => {
    let claimed = false;
    pendingLifetimeClaims.set(request, () => {
      if (claimed) return;
      claimed = true;
      server.timeout(request, 0);
    });
    try {
      return await listenerFetch(request);
    } finally {
      pendingLifetimeClaims.delete(request);
    }
  };
}

/** Claims the admitted dispatch lifetime after authentication, concurrency, and bounded body receipt. */
export function claimModelGatewayRequestLifetime(request: Request): void {
  pendingLifetimeClaims.get(request)?.();
}
