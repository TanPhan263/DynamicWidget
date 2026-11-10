import { centered, clampOffset, displayScale, sourceRect, zoomAround } from "./crop";

const photo = { width: 4000, height: 3000 };
const pill = { width: 480, height: 60 };

it("covers the frame at zoom 1", () => {
  const s = displayScale(photo, pill, 1);
  expect(photo.width * s).toBeCloseTo(480);
  expect(photo.height * s).toBeGreaterThanOrEqual(60);
});

it("never lets the frame show past the picture's edges", () => {
  const s = displayScale(photo, pill, 1);
  expect(clampOffset({ x: 50, y: 50 }, photo, pill, s)).toEqual({ x: 0, y: 0 });
  const far = clampOffset({ x: -9999, y: -9999 }, photo, pill, s);
  expect(far.x).toBeCloseTo(480 - photo.width * s);
  expect(far.y).toBeCloseTo(60 - photo.height * s);
});

it("crops the part the frame shows, in the picture's pixels", () => {
  const s = displayScale(photo, pill, 2);
  const r = sourceRect(centered(photo, pill, s), pill, s);
  // Twice the zoom shows half the width, centered.
  expect(r.width).toBeCloseTo(2000);
  expect(r.x).toBeCloseTo(1000);
  expect(r.height / r.width).toBeCloseTo(60 / 480);
});

it("zooms around the frame's center", () => {
  const frame = { width: 400, height: 300 };
  const before = { x: -100, y: -50 };
  const after = zoomAround(before, frame, 1, 2);
  // The picture point under the center stays under it.
  expect((200 - before.x) / 1).toBeCloseTo((200 - after.x) / 2);
  expect((150 - before.y) / 1).toBeCloseTo((150 - after.y) / 2);
});
