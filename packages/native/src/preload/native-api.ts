import { contextBridge, ipcRenderer } from "electron";
import type {
  GuiBrowserOperatorInput,
} from "@kilnai/gateway-contracts";
import type {
  NativeBrowserRegionBounds,
} from "../shared/native-browser-operator-surface.js";

const nativeBrowser = {
  open(bounds: NativeBrowserRegionBounds): Promise<unknown> {
    return ipcRenderer.invoke("native-browser:open", bounds);
  },
  resize(bounds: NativeBrowserRegionBounds): Promise<unknown> {
    return ipcRenderer.invoke("native-browser:resize", bounds);
  },
  takeover(): Promise<unknown> {
    return ipcRenderer.invoke("native-browser:takeover");
  },
  sendInput(input: GuiBrowserOperatorInput): Promise<unknown> {
    return ipcRenderer.invoke("native-browser:input", input);
  },
  release(): Promise<unknown> {
    return ipcRenderer.invoke("native-browser:release");
  },
  resumeRuntime(): Promise<unknown> {
    return ipcRenderer.invoke("native-browser:runtime-resume");
  },
};

contextBridge.exposeInMainWorld("kilnNativeBrowser", nativeBrowser);
