import { ISLAND_SIZE_RANGE, type IslandLayout, type IslandStyle, type WidgetSpan } from "../shared/types";

// The island window is a fixed 1000×800 CSS-pixel canvas at the top center
// of the primary display (see `core/island.rs`). Everything outside the
// island's rectangle lets clicks through, so these sizes decide both what
// the island looks like and where it is clickable.

export const WINDOW_WIDTH = 1000;
export const WINDOW_HEIGHT = 800;

export type View = "compact" | "peek" | "expanded";

/**
 * The island's shape morph. A slightly underdamped spring gives the small
 * overshoot of the iPhone Dynamic Island without wobbling.
 */
export const ISLAND_SPRING = { type: "spring", stiffness: 380, damping: 30, mass: 0.9 } as const;

/** Closing is quicker and does not overshoot, so it never lingers as a big black shape. */
export const ISLAND_CLOSE_SPRING = { type: "spring", stiffness: 560, damping: 46, mass: 0.8 } as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rounding of the top corners; 0 when the island hangs from the top edge. */
  topRadius: number;
  bottomRadius: number;
}

export const WING = 64;
/** Extra width for the now-playing title pinned in the compact island. */
export const TITLE_WIDTH = 150;
export const EXPANDED_WIDTH = 640;
export const PEEK_WIDTH = 420;
export const PEEK_BODY = 72;
export const WIDGET_COLUMNS = 3;
export const CARD_HEIGHT = 132;
export const GAP = 10;
export const PADDING = 14;
export const HEADER = 30;
/** Pill hanging from the top edge where there is no notch. */
const BAR_WIDTH = 190;
const EDGE_HEIGHT = 32;
/** The Dynamic Island capsule: a gap above it, and a little taller than a menu bar. */
const CAPSULE_GAP = 6;
const CAPSULE_WIDTH = 196;
const CAPSULE_HEIGHT = 36;

export interface Shape {
  /** The island hangs from the top edge (notch or menu bar). */
  attached: boolean;
  /** The compact island is the notch itself; content only fits in the wings. */
  hugsNotch: boolean;
  /** Show a clock and battery while nothing else is going on. */
  idleInfo: boolean;
  /** Space reserved at the top for the notch, which shows no pixels. */
  topInset: number;
  compactWidth: number;
  compactHeight: number;
  top: number;
}

function hanging(layout: IslandLayout): Shape {
  if (layout.notch) {
    return {
      attached: true,
      hugsNotch: true,
      idleInfo: false,
      topInset: layout.notch.height,
      compactWidth: layout.notch.width,
      compactHeight: layout.notch.height,
      top: 0,
    };
  }
  const height = layout.platform === "macos" ? Math.max(layout.menuBarHeight, 24) : EDGE_HEIGHT;
  return { attached: true, hugsNotch: false, idleInfo: true, topInset: 0, compactWidth: BAR_WIDTH, compactHeight: height, top: 0 };
}

export function shapeFor(layout: IslandLayout, style: IslandStyle): Shape {
  if (style === "island") {
    // Like the iPhone: an empty black capsule until there is something to
    // show. On a notched Mac it sits just below the notch.
    return {
      attached: false,
      hugsNotch: false,
      idleInfo: false,
      topInset: 0,
      compactWidth: CAPSULE_WIDTH,
      compactHeight: CAPSULE_HEIGHT,
      top: (layout.notch?.height ?? 0) + CAPSULE_GAP,
    };
  }
  return hanging(layout);
}

/**
 * Island content is laid out at 100% and zoomed by this factor, so every
 * size stays crisp and keeps the same proportions.
 */
export function islandScale(percent: number, range: readonly [number, number] = ISLAND_SIZE_RANGE): number {
  const p = Number.isFinite(percent) ? percent : 100;
  return Math.min(range[1], Math.max(range[0], p)) / 100;
}

/** More widget rows than this scroll inside the panel. */
export const MAX_VISIBLE_ROWS = 3;

/**
 * Rows the widgets fill when placed in order the way CSS grid's (sparse)
 * auto-placement does: each widget goes to the first spot at or after the
 * previous one where it fits, starting a new row when it does not.
 */
export function widgetRows(spans: (WidgetSpan | undefined)[]): number {
  const taken: boolean[][] = [];
  const free = (r: number, c: number, span: WidgetSpan) => {
    for (let dr = 0; dr < span.rows; dr++) {
      for (let dc = 0; dc < span.cols; dc++) if (taken[r + dr]?.[c + dc]) return false;
    }
    return true;
  };
  let row = 0;
  let col = 0;
  for (const given of spans) {
    const span = { cols: Math.min(given?.cols ?? 1, WIDGET_COLUMNS), rows: given?.rows ?? 1 };
    while (col + span.cols > WIDGET_COLUMNS || !free(row, col, span)) {
      col += 1;
      if (col + span.cols > WIDGET_COLUMNS) {
        row += 1;
        col = 0;
      }
    }
    for (let dr = 0; dr < span.rows; dr++) {
      taken[row + dr] ??= [];
      for (let dc = 0; dc < span.cols; dc++) taken[row + dr][col + dc] = true;
    }
    col += span.cols;
  }
  return Math.max(1, taken.length);
}

export function expandedHeight(shape: Shape, rows: number, scale = 1): number {
  const visible = Math.min(rows, MAX_VISIBLE_ROWS);
  const body = PADDING + HEADER + GAP + visible * CARD_HEIGHT + (visible - 1) * GAP + PADDING;
  return shape.topInset + body * scale;
}

/**
 * The shape as the zoomed content sees it. The notch has a fixed physical
 * size, so the parts that match it are divided by the zoom.
 */
export function contentShape(shape: Shape, scale: number): Shape {
  if (!shape.hugsNotch) return { ...shape, topInset: shape.topInset / scale };
  return {
    ...shape,
    topInset: shape.topInset / scale,
    compactWidth: shape.compactWidth / scale,
    compactHeight: shape.compactHeight / scale,
  };
}

/** The island's rectangle in window CSS pixels for a view. */
export function islandBox(shape: Shape, view: View, opts: { wings: boolean; rows: number; scale?: number; title?: boolean }): Box {
  const scale = opts.scale ?? 1;
  let width: number;
  let height: number;
  switch (view) {
    case "expanded":
      width = EXPANDED_WIDTH * scale;
      height = expandedHeight(shape, opts.rows, scale);
      break;
    case "peek":
      width = PEEK_WIDTH * scale;
      height = shape.topInset + PEEK_BODY * scale;
      break;
    default: {
      // The notch itself never scales; the wings beside it do.
      const base = shape.hugsNotch ? shape.compactWidth : shape.compactWidth * scale;
      width = base + (opts.wings ? WING * 2 * scale : 0) + (opts.title ? TITLE_WIDTH * scale : 0);
      height = shape.hugsNotch ? shape.compactHeight : shape.compactHeight * scale;
    }
  }
  width = Math.round(width);
  height = Math.round(height);
  const big = view !== "compact";
  const bottomRadius = shape.attached
    ? big
      ? 32 * scale
      : Math.min(12, height / 2)
    : big
      ? 36 * scale
      : height / 2;
  return {
    x: Math.round((WINDOW_WIDTH - width) / 2),
    y: shape.top,
    width,
    height,
    topRadius: shape.attached ? 0 : bottomRadius,
    bottomRadius,
  };
}
