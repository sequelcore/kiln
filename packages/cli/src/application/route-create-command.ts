import { ExecutionRouteCreationRequestSchema, type ExecutionRouteCreationRequest } from "@kilnai/gateway-contracts";

export async function runRouteCreateCommand(input: {
  readonly source: string;
  readonly preview: boolean;
  readonly create: (request: ExecutionRouteCreationRequest, preview: boolean) => Promise<{ readonly status: string; readonly revision: string }>;
}) {
  const decoded: unknown = JSON.parse(input.source);
  const request = ExecutionRouteCreationRequestSchema.parse(decoded);
  return input.create(request, input.preview);
}
