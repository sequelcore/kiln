import type { OperatorThemeName } from "@kilnai/gateway-contracts";
import { ThemeSwitcher } from "./theme-switcher.js";

export function AppearanceSettingsPanel(props: {
  readonly onThemeSelected: (theme: OperatorThemeName) => void;
}) {
  return (
    <section aria-label="Appearance settings" className="min-h-0 flex-1 overflow-auto bg-workspace-viewer">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10">
        <section aria-labelledby="appearance-theme-heading">
          <div className="flex flex-col gap-4 border-b border-border/70 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
            <div className="min-w-0">
              <h2 id="appearance-theme-heading" className="text-sm font-medium text-foreground">Theme</h2>
              <p className="mt-1 max-w-xl text-sm leading-5 text-muted-foreground">
                Choose how Kiln follows or overrides the operating system appearance.
              </p>
            </div>
            <ThemeSwitcher onThemeSelected={props.onThemeSelected} />
          </div>
        </section>
      </div>
    </section>
  );
}
