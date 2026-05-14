import type {
  GuiBrowserOperatorInput,
  GuiBrowserSessionState,
} from "@kilnai/gateway-contracts";
import type {
  NativeBrowserOperatorSurfaceProjection,
} from "../shared/native-browser-operator-surface";
import type {
  NativeBrowserRegionBounds,
} from "../shared/native-browser-operator-surface";

export interface EmbeddedBrowserOperatorSurfaceSnapshot {
  readonly state: GuiBrowserSessionState;
  readonly projection: NativeBrowserOperatorSurfaceProjection;
  readonly observation: {
    readonly url: string;
    readonly title: string;
    readonly viewport: {
      readonly width: number;
      readonly height: number;
    };
    readonly scrollY: number;
    readonly proofInputValue?: string;
  };
  readonly evidence: readonly {
    readonly kind: string;
    readonly payload: unknown;
    readonly timestamp: string;
  }[];
}

declare global {
  interface Window {
    readonly kilnNativeBrowser?: {
      readonly open: (bounds: NativeBrowserRegionBounds) => Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
      readonly resize: (bounds: NativeBrowserRegionBounds) => Promise<EmbeddedBrowserOperatorSurfaceSnapshot | null>;
      readonly takeover: () => Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
      readonly sendInput: (input: GuiBrowserOperatorInput) => Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
      readonly release: () => Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
      readonly resumeRuntime: () => Promise<EmbeddedBrowserOperatorSurfaceSnapshot>;
    };
  }
}

export {};
