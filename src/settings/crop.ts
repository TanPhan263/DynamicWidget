import type { BackgroundSlot } from "../shared/types";

/**
 * Width / height each picture is cropped to. The panel is 640 wide and about
 * 520 tall with three rows; the floating island is 5–12 times wider than tall
 * depending on what it shows. Backgrounds fill with `cover`, so close is enough.
 */
export const CROP_ASPECT: Record<BackgroundSlot, number> = { panel: 4 / 3, island: 8 };

/** Width the cropped picture is saved at. */
export const CROP_WIDTH: Record<BackgroundSlot, number> = { panel: 1600, island: 1200 };

export const MAX_ZOOM = 4;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The picture's scale on screen: at zoom 1 it just covers the frame. */
export function displayScale(image: Size, frame: Size, zoom: number): number {
  return Math.max(frame.width / image.width, frame.height / image.height) * zoom;
}

/** Keeps the picture's top-left corner where the picture still covers the whole frame. */
export function clampOffset(offset: Point, image: Size, frame: Size, scale: number): Point {
  const minX = frame.width - image.width * scale;
  const minY = frame.height - image.height * scale;
  return {
    x: Math.min(0, Math.max(minX, offset.x)),
    y: Math.min(0, Math.max(minY, offset.y)),
  };
}

/** The picture centered in the frame at a scale. */
export function centered(image: Size, frame: Size, scale: number): Point {
  return { x: (frame.width - image.width * scale) / 2, y: (frame.height - image.height * scale) / 2 };
}

/** Zooms keeping the frame's center on the same spot of the picture. */
export function zoomAround(offset: Point, frame: Size, from: number, to: number): Point {
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  return { x: cx - ((cx - offset.x) / from) * to, y: cy - ((cy - offset.y) / from) * to };
}

/** The part of the picture, in its own pixels, that the frame shows. */
export function sourceRect(offset: Point, frame: Size, scale: number) {
  return { x: -offset.x / scale, y: -offset.y / scale, width: frame.width / scale, height: frame.height / scale };
}
