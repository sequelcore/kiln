export interface OperatorSurfaceThemeController {
  readonly setTheme: (input: {
    readonly theme: string;
    readonly reason?: string;
  }) => Promise<{ readonly ok: boolean; readonly appliedTheme?: string; readonly error?: string }>;
}

export interface OperatorSurfaceController {
  readonly theme?: OperatorSurfaceThemeController;
}
