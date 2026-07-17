export type SessionExecutionScope =
  | {
      readonly kind: "goal";
      readonly goalRunId: string;
      readonly managedInvocationId?: string;
    }
  | {
      readonly kind: "work_item";
      readonly goalRunId: string;
      readonly workItemId: string;
      readonly attemptId?: string;
      readonly managedInvocationId?: string;
    };
