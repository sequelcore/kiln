export interface TuiOperatorThemeRequest {
  readonly theme: string;
  readonly reason?: string;
}

export interface TuiOperatorThemeResult {
  readonly ok: boolean;
  readonly appliedTheme?: string;
  readonly error?: string;
}

export type TuiOperatorThemeHandler = (
  input: TuiOperatorThemeRequest,
) => TuiOperatorThemeResult | Promise<TuiOperatorThemeResult>;

let currentHandler: TuiOperatorThemeHandler | null = null;

export function setTuiOperatorThemeHandler(handler: TuiOperatorThemeHandler): () => void {
  currentHandler = handler;
  return () => {
    if (currentHandler === handler) {
      currentHandler = null;
    }
  };
}

export async function applyTuiOperatorThemeRequest(
  input: TuiOperatorThemeRequest,
): Promise<TuiOperatorThemeResult> {
  if (!currentHandler) {
    return { ok: false, error: "TUI theme control is unavailable." };
  }
  return currentHandler(input);
}
