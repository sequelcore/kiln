import { KilnWidget } from "./widget.js";
import type { WidgetConfig } from "./types.js";

(function () {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  const gatewayUrl = script.dataset["gateway"];
  const appName = script.dataset["app"];
  const widgetId = script.dataset["widgetId"];

  if (!gatewayUrl || !appName || !widgetId) return;

  const config: WidgetConfig = {
    gatewayUrl,
    appName,
    widgetId,
    position: (script.dataset["position"] as WidgetConfig["position"]) ?? "bottom-right",
    theme: (script.dataset["theme"] as WidgetConfig["theme"]) ?? "auto",
    greeting: script.dataset["greeting"],
    placeholder: script.dataset["placeholder"],
  };

  const init = () => new KilnWidget(config);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

export { KilnWidget } from "./widget.js";
export type { WidgetConfig, VisitorInfo, PreChatFieldConfig, PreChatFormFrame, ChatMessage, ConnectionStatus } from "./types.js";
