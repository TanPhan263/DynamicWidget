import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "motion/react";

// Animations finish instantly so tests see final states.
MotionGlobalConfig.skipAnimations = true;

// jsdom lacks these browser APIs; Radix (Slider) and the theme hook use them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no PointerEvent; without it fireEvent.pointer* drops clientX and
// button. A MouseEvent with a pointer id is enough for these tests.
const win = window as unknown as { PointerEvent?: unknown };
if (!win.PointerEvent) {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  win.PointerEvent = PointerEventStub;
}
