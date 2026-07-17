import { KilnWidget } from "./widget.js";
import type { WidgetConfig } from "./types.js";

const script = document.currentScript as HTMLScriptElement | null;

if (script) {
  const gatewayUrl = script.dataset["gateway"];
  const appName = script.dataset["app"];
  const widgetId = script.dataset["widgetId"];

  if (gatewayUrl && appName && widgetId) {
    const config: WidgetConfig = {
      gatewayUrl,
      appName,
      widgetId,
      position: (script.dataset["position"] as WidgetConfig["position"]) ?? "bottom-right",
      theme: (script.dataset["theme"] as WidgetConfig["theme"]) ?? "auto",
      greeting: script.dataset["greeting"],
      placeholder: script.dataset["placeholder"],
      logoUrl: script.dataset["logo"],
      logoAlt: script.dataset["logoAlt"],
    };

    const initialize = () => new KilnWidget(config);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  }
}
