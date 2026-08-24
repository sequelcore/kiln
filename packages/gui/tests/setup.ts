import { createRequire } from "node:module";
import { expect } from "vitest";

const require = createRequire(import.meta.url);
const matchers = require("@testing-library/jest-dom/matchers") as Parameters<typeof expect.extend>[0];

expect.extend(matchers);

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock;

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};

function scrollTo(): void;
function scrollTo(options: ScrollToOptions): void;
function scrollTo(x: number, y: number): void;
function scrollTo(this: HTMLElement, optionsOrX?: ScrollToOptions | number, y?: number): void {
  this.scrollTop = typeof optionsOrX === "number"
    ? y ?? 0
    : optionsOrX?.top ?? this.scrollTop;
}

HTMLElement.prototype.scrollTo = scrollTo;

HTMLElement.prototype.getAnimations = function getAnimations(): Animation[] {
  return [];
};

function getContext(this: HTMLCanvasElement, contextId: "2d", options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
function getContext(this: HTMLCanvasElement, contextId: "bitmaprenderer", options?: ImageBitmapRenderingContextSettings): ImageBitmapRenderingContext | null;
function getContext(this: HTMLCanvasElement, contextId: "webgl" | "experimental-webgl", options?: WebGLContextAttributes): WebGLRenderingContext | null;
function getContext(this: HTMLCanvasElement, contextId: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
function getContext(this: HTMLCanvasElement, contextId: string, options?: unknown): RenderingContext | null;
function getContext(this: HTMLCanvasElement, _contextId: string, _options?: unknown): RenderingContext | null {
  return null;
}

HTMLCanvasElement.prototype.getContext = getContext;
