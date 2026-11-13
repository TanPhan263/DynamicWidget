import { ISLAND_SIZE_RANGE, type IslandIcons, type IslandLayout, type IslandStat, type IslandStyle, type WidgetSpan } from "../shared/types";

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
/** A wing beside the notch fits two round icons, or the clock alone. */
export const SIDE_SLOTS = 2;
export const iconSlots = (id: IslandStat) => (id === "time" ? 2 : 1);
export const slotsOf = (ids: IslandStat[]) => ids.reduce((n, id) => n + iconSlots(id), 0);

/**
 * The icons as a notch island shows them, so its wings never grow: what does
 * not fit on the left moves to the right, and what fits on neither is left out.
 */
export function fitSides(icons: IslandIcons): IslandIcons {
  const left: IslandStat[] = [];
  const right: IslandStat[] = [];
  const over: IslandStat[] = [];
  for (const id of icons.left) (slotsOf(left) + iconSlots(id) <= SIDE_SLOTS ? left : over).push(id);
  for (const id of [...icons.right, ...over]) if (slotsOf(right) + iconSlots(id) <= SIDE_SLOTS) right.push(id);
  return { left, right };
}
/** Round status icons are 22 px; inside a group they sit 6 px apart, the two groups 12 px apart. */
const ICON = 22;
export const ICON_GAP = 6;
const GROUP_GAP = 12;
/** Space between a pill's (or a notch wing's) icons and its rounded end. */
export const ICON_SIDE = 10;

/** A row of icons side by side; the clock counts as two. */
const groupWidth = (ids: IslandStat[]) => (ids.length ? slotsOf(ids) * ICON + (slotsOf(ids) - 1) * ICON_GAP : 0);

/** Width a pill needs for just these icons, so it hugs them. */
export function iconsWidth({ left, right }: IslandIcons): number {
  const content = groupWidth(left) + groupWidth(right) + (left.length && right.length ? GROUP_GAP : 0);
  return content + 2 * ICON_SIDE;
}

/**
 * Each wing beside a notch holding icons alone: the outer side padded as on a
 * pill, an icon gap beside the notch. Both take the fuller side's width, so
 * the notch stays in the middle.
 */
export function wingWidth({ left, right }: IslandIcons): number {
  return Math.max(groupWidth(left), groupWidth(right)) + ICON_SIDE + ICON_GAP;
}

/** Extra width for the now-playing title pinned in the compact island. */
export const TITLE_WIDTH = 40;
/** Extra width for the previous, play/pause and next buttons beside that title. */
export const CONTROLS_WIDTH = 60;
export const EXPANDED_WIDTH = 640;
export const PEEK_WIDTH = 420;
export const PEEK_BODY = 72;
export const WIDGET_COLUMNS = 3;
export const CARD_HEIGHT = 133;
export const GAP = 10;
export const PADDING = 14;
export const HEADER = 30;
/** Tall enough for the icons with as much room above and below as beside them (42 px). */
const ICON_ROW_HEIGHT = ICON + 2 * ICON_SIDE;
/** Pill hanging from the top edge where there is no notch; it may hang below a short menu bar. */
const BAR_WIDTH = 190;
/** The Dynamic Island capsule: a gap above it. */
const CAPSULE_GAP = 6;
const CAPSULE_WIDTH = 196;
const CAPSULE_HEIGHT = ICON_ROW_HEIGHT;

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
  // At least as tall as the menu bar (macOS), and tall enough for even room around the icons.
  const height = Math.max(layout.platform === "macos" ? layout.menuBarHeight : 0, ICON_ROW_HEIGHT);
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

/** Room left between the open panel and the bottom of the screen. */
export const SCREEN_MARGIN = 16;

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

/**
 * The open panel fits every row, up to the bottom of the screen. Past that it
 * stops at the last whole row that fits, so no row shows cut off, and the rest scroll.
 */
export function expandedHeight(shape: Shape, rows: number, scale = 1, screenHeight = Infinity): number {
  const height = (n: number) => shape.topInset + (PADDING + HEADER + GAP + n * CARD_HEIGHT + (n - 1) * GAP + PADDING) * scale;
  const room = screenHeight - shape.top - SCREEN_MARGIN;
  let shown = Math.max(1, rows);
  while (shown > 1 && height(shown) > room) shown--;
  return height(shown);
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
export function islandBox(
  shape: Shape,
  view: View,
  opts: {
    wings: boolean;
    rows: number;
    scale?: number;
    title?: boolean;
    controls?: boolean;
    screenHeight?: number;
    /** Icons shown alone: a pill hugs them, and the wings beside a notch fit them. */
    icons?: IslandIcons;
  },
): Box {
  const scale = opts.scale ?? 1;
  let width: number;
  let height: number;
  switch (view) {
    case "expanded":
      width = EXPANDED_WIDTH * scale;
      height = expandedHeight(shape, opts.rows, scale, opts.screenHeight);
      break;
    case "peek":
      width = PEEK_WIDTH * scale;
      height = shape.topInset + PEEK_BODY * scale;
      break;
    default: {
      // The notch itself never scales; the wings beside it do.
      const icons = opts.icons && opts.icons.left.length + opts.icons.right.length > 0 ? opts.icons : null;
      const hugsIcons = !shape.hugsNotch && !opts.wings && !!icons;
      const base = shape.hugsNotch ? shape.compactWidth : (hugsIcons ? iconsWidth(icons!) : shape.compactWidth) * scale;
      const wing = shape.hugsNotch && icons ? wingWidth(icons) : WING;
      width =
        base +
        (opts.wings ? wing * 2 * scale : 0) +
        (opts.title ? TITLE_WIDTH * scale : 0) +
        (opts.controls ? CONTROLS_WIDTH * scale : 0);
      height = shape.hugsNotch ? shape.compactHeight : shape.compactHeight * scale;
    }
  }
  width = Math.round(width);
  height = Math.round(height);
  const big = view !== "compact";
  const bottomRadius = shape.attached
    ? big
      ? 20 * scale
      : Math.min(12, height / 2)
    : big
      ? 22 * scale
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
