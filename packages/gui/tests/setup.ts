import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock;

HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};

HTMLElement.prototype.getAnimations = function getAnimations(): Animation[] {
  return [];
};

const canvasContext = {
  canvas: null as HTMLCanvasElement | null,
  arc: () => undefined,
  arcTo: () => undefined,
  beginPath: () => undefined,
  clearRect: () => undefined,
  closePath: () => undefined,
  fill: () => undefined,
  fillText: () => undefined,
  lineTo: () => undefined,
  measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
  moveTo: () => undefined,
  restore: () => undefined,
  save: () => undefined,
  setTransform: () => undefined,
  stroke: () => undefined,
};

HTMLCanvasElement.prototype.getContext = function getContext() {
  canvasContext.canvas = this;
  return canvasContext as unknown as CanvasRenderingContext2D;
};
