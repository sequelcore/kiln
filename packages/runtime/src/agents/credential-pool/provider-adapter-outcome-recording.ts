import type { CreateMessageOptions, ProviderAdapter } from "@kilnai/core/agents";

export interface ProviderAdapterOutcomeRecordingOptions {
  readonly delegate: ProviderAdapter;
  readonly recordOutcome: (error?: unknown) => Promise<void>;
}

/** Decorates provider I/O without hiding the delegate's declared transports. */
export function withProviderAdapterOutcomeRecording(
  options: ProviderAdapterOutcomeRecordingOptions,
): ProviderAdapter {
  const { delegate, recordOutcome } = options;
  return {
    name: delegate.name,
    ...(delegate.deliberationTransport === undefined
      ? {}
      : { deliberationTransport: delegate.deliberationTransport }),
    ...(delegate.communicationTransport === undefined
      ? {}
      : { communicationTransport: delegate.communicationTransport }),
    createMessage: async (messageOptions: CreateMessageOptions) => {
      try {
        const response = await delegate.createMessage(messageOptions);
        await recordOutcome();
        return response;
      } catch (error) {
        await recordOutcome(error);
        throw error;
      }
    },
    streamMessage: async function* (messageOptions: CreateMessageOptions) {
      try {
        yield* delegate.streamMessage(messageOptions);
        await recordOutcome();
      } catch (error) {
        await recordOutcome(error);
        throw error;
      }
    },
  };
}
