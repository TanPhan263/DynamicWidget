import type { WidgetId } from "../shared/types";

/** Turning a widget on adds it at the end of the island. */
export function toggleWidget(enabled: readonly WidgetId[], id: WidgetId): WidgetId[] {
  return enabled.includes(id) ? enabled.filter((w) => w !== id) : [...enabled, id];
}

/** Moves an enabled widget one place earlier (-1) or later (+1). */
export function moveWidget(enabled: readonly WidgetId[], id: WidgetId, by: -1 | 1): WidgetId[] {
  const i = enabled.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= enabled.length) return [...enabled];
  const next = [...enabled];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Moves `active` to where `over` is, as when a dragged widget is dropped on another. */
export function dropWidget(enabled: readonly WidgetId[], active: WidgetId, over: WidgetId): WidgetId[] {
  const from = enabled.indexOf(active);
  const to = enabled.indexOf(over);
  if (from < 0 || to < 0 || from === to) return [...enabled];
  const next = [...enabled];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
