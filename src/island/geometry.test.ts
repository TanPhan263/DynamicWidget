import {
  contentShape,
  CONTROLS_WIDTH,
  EXPANDED_WIDTH,
  expandedHeight,
  islandBox,
  islandScale,
  SCREEN_MARGIN,
  shapeFor,
  widgetRows,
  TITLE_WIDTH,
  WING,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  fitSides,
  iconsWidth,
} from "./geometry";

import type { IslandLayout } from "../shared/types";

const notchedMac: IslandLayout = { platform: "macos", notch: { width: 200, height: 37 }, menuBarHeight: 37 };
const plainMac: IslandLayout = { platform: "macos", notch: null, menuBarHeight: 24 };
const windows: IslandLayout = { platform: "windows", notch: null, menuBarHeight: 0 };

const notch = shapeFor(notchedMac, "notch");
const bar = shapeFor(plainMac, "notch");
const edge = shapeFor(windows, "notch");

describe("island geometry", () => {
  it("hugs the notch when compact", () => {
    const b = islandBox(notch, "compact", { wings: false, rows: 2 });
    expect(b).toMatchObject({ width: 200, height: 37, y: 0, topRadius: 0 });
    expect(b.x).toBe((WINDOW_WIDTH - 200) / 2);
  });

  it("grows wings around the notch for live activities", () => {
    expect(islandBox(notch, "compact", { wings: true, rows: 2 }).width).toBe(200 + WING * 2);
  });

  it("keeps content below the notch when open", () => {
    expect(expandedHeight(notch, 1) - expandedHeight(bar, 1)).toBe(37);
    const b = islandBox(notch, "expanded", { wings: false, rows: 2 });
    expect(b.width).toBe(EXPANDED_WIDTH);
    expect(b.height).toBeLessThanOrEqual(420);
  });

  it("widens for the pinned title and its buttons", () => {
    const plain = islandBox(edge, "compact", { wings: false, rows: 1 }).width;
    expect(islandBox(edge, "compact", { wings: false, rows: 1, title: true }).width).toBe(plain + TITLE_WIDTH);
    expect(islandBox(edge, "compact", { wings: false, rows: 1, title: true, controls: true }).width).toBe(
      plain + TITLE_WIDTH + CONTROLS_WIDTH,
    );
  });

  it("hangs from the top edge on Windows", () => {
    const b = islandBox(edge, "compact", { wings: false, rows: 1 });
    expect(b).toMatchObject({ y: 0, topRadius: 0 });
  });

  it("uses at least one widget row", () => {
    expect(widgetRows([])).toBe(1);
    expect(widgetRows(Array(3).fill(undefined))).toBe(1);
    expect(widgetRows(Array(5).fill({ cols: 1, rows: 1 }))).toBe(2);
  });

  it("packs spans like CSS grid", () => {
    const s = (cols: number, rows = 1) => ({ cols, rows });
    expect(widgetRows([s(2), s(1), s(1), s(1), s(1)])).toBe(2);
    // A wide widget that does not fit at the end of a row starts a new one.
    expect(widgetRows([s(1), s(1), s(2), s(1)])).toBe(2);
    expect(widgetRows([s(1), s(1), s(2), s(2)])).toBe(3);
    expect(widgetRows([s(3), s(3)])).toBe(2);
    // A 2×2 widget leaves one column beside it for two small widgets.
    expect(widgetRows([s(2, 2), s(1), s(1)])).toBe(2);
    expect(widgetRows([s(2, 2), s(1), s(1), s(1)])).toBe(3);
    // Later widgets never move back before earlier ones.
    expect(widgetRows([s(1), s(3), s(1)])).toBe(3);
  });

  it("scales everything except the notch", () => {
    const medium = islandBox(notch, "compact", { wings: true, rows: 2 });
    const large = islandBox(notch, "compact", { wings: true, rows: 2, scale: 1.12 });
    expect(large.height).toBe(medium.height);
    expect(large.width - 200).toBe(Math.round(WING * 2 * 1.12));
    const open = islandBox(bar, "expanded", { wings: false, rows: 2, scale: 1.12 });
    expect(open.width).toBe(Math.round(EXPANDED_WIDTH * 1.12));
    expect(contentShape(notch, 1.12).compactWidth * 1.12).toBeCloseTo(200);
  });

  it("grows with every row up to the bottom of the screen, then scrolls", () => {
    expect(expandedHeight(bar, 4)).toBeGreaterThan(expandedHeight(bar, 3));
    // Stops at the last whole row that fits; one more row would be cut.
    const room = 1080 - bar.top - SCREEN_MARGIN;
    const capped = expandedHeight(bar, 9, 1, 1080);
    const shown = [...Array(9).keys()].map((i) => i + 1).find((n) => expandedHeight(bar, n) === capped)!;
    expect(capped).toBeLessThanOrEqual(room);
    expect(expandedHeight(bar, shown + 1)).toBeGreaterThan(room);
    expect(expandedHeight(bar, 2, 1, 1080)).toBe(expandedHeight(bar, 2));
  });

  it("hangs from the top edge on Windows with the notch style", () => {
    const edge = shapeFor(windows, "notch");
    expect(edge).toMatchObject({ attached: true, top: 0, idleInfo: true });
    expect(islandBox(edge, "compact", { wings: false, rows: 1 }).topRadius).toBe(0);
  });

  it("draws an empty floating capsule with the Dynamic Island style", () => {
    for (const layout of [plainMac, windows]) {
      const capsule = shapeFor(layout, "island");
      expect(capsule).toMatchObject({ attached: false, hugsNotch: false, idleInfo: false, topInset: 0 });
      const b = islandBox(capsule, "compact", { wings: false, rows: 1 });
      expect(b.y).toBeGreaterThan(0);
      expect(b.topRadius).toBe(b.height / 2);
      const open = islandBox(capsule, "expanded", { wings: false, rows: 1 });
      expect(open.topRadius).toBe(open.bottomRadius);
    }
  });

  it("puts the Dynamic Island below a notch", () => {
    expect(shapeFor(notchedMac, "island").top).toBeGreaterThan(37);
  });

  it("always fits the screen, even at the largest size with every row", () => {
    const shapes = [notch, bar, edge, shapeFor(windows, "island"), shapeFor(notchedMac, "island")];
    for (const shape of shapes) {
      for (const scale of [islandScale(0), 1, islandScale(999)]) {
        const b = islandBox(shape, "expanded", { wings: false, rows: 12, scale, screenHeight: WINDOW_HEIGHT });
        expect(b.y + b.height).toBeLessThanOrEqual(WINDOW_HEIGHT);
        expect(b.x).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("clamps the size percent to its range", () => {
    expect(islandScale(100)).toBe(1);
    expect(islandScale(20)).toBe(0.5);
    expect(islandScale(200)).toBe(1.5);
    expect(islandScale(Number.NaN)).toBe(1);
    expect(islandScale(50, [80, 150])).toBe(0.8);
  });
});

describe("iconsWidth", () => {
  it("leaves 10 px between the icons and the pill's ends", () => {
    // Four icons: 4 × 22 + 3 × 6 + 2 × 10.
    expect(iconsWidth({ left: ["weather", "cpu", "memory", "battery"], right: [] })).toBe(126);
    // Two groups sit 12 apart; the clock counts as two icons.
    expect(iconsWidth({ left: ["cpu"], right: ["time", "battery"] })).toBe(22 + 12 + (3 * 22 + 2 * 6) + 20);
    expect(iconsWidth({ left: ["cpu"], right: [] })).toBe(42);
  });

  it("only changes a pill that shows icons alone", () => {
    const pill = shapeFor(plainMac, "island");
    expect(islandBox(pill, "compact", { wings: false, rows: 1, icons: { left: ["weather", "cpu", "memory", "battery"], right: [] } }).width).toBe(126);
    expect(islandBox(pill, "compact", { wings: false, rows: 1 }).width).toBe(pill.compactWidth);
    // Beside a notch each wing fits the fuller side: one icon, 10 outside, 6 by the notch.
    expect(islandBox(notch, "compact", { wings: true, rows: 1, icons: { left: ["cpu"], right: [] } }).width).toBe(200 + 2 * (22 + 10 + 6));
    // Other things in the wings keep them at their usual width.
    expect(islandBox(notch, "compact", { wings: true, rows: 1 }).width).toBe(200 + WING * 2);
  });
});

describe("fitSides", () => {
  it("keeps each wing to two round icons or the clock", () => {
    expect(fitSides({ left: ["cpu", "memory"], right: ["time"] })).toEqual({ left: ["cpu", "memory"], right: ["time"] });
    // What the left can't hold moves right; what fits nowhere is left out.
    expect(fitSides({ left: ["cpu", "memory", "disk", "mail"], right: [] })).toEqual({ left: ["cpu", "memory"], right: ["disk", "mail"] });
    expect(fitSides({ left: ["time", "cpu"], right: ["date", "mail"] })).toEqual({ left: ["time"], right: ["date", "mail"] });
  });
});
