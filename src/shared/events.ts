import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BackgroundSlot, IslandLayout, IslandNotification, QuoteState, Settings, SystemStats } from "./types";

/** Events emitted by the Rust side, with their payloads. */
export interface CoreEvents {
  notification: IslandNotification;
  "notifications-changed": IslandNotification[];
  "settings-changed": Settings;
  "state-changed": null;
  "shortcut-conflict": string;
  "system-stats": SystemStats;
  "island-hover": boolean;
  "island-layout": IslandLayout;
  "island-toggle": null;
  "quotes-changed": QuoteState[];
  /** A background picture changed: its data URL, or null once removed. */
  "background-changed": { slot: BackgroundSlot; image: string | null };
}

export type CoreEvent = keyof CoreEvents;

export type Handlers = { [E in CoreEvent]?: (payload: CoreEvents[E]) => void };

/**
 * Subscribes to the given core events; returns a function that removes all
 * listeners. Safe to call from an effect: listeners registered after the
 * effect is cleaned up are removed as soon as they resolve.
 */
export function listenAll(handlers: Handlers): () => void {
  let disposed = false;
  const pending: Promise<UnlistenFn>[] = [];
  for (const [name, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    pending.push(listen(name, (e) => (handler as (p: unknown) => void)(e.payload)));
  }
  const all = Promise.all(pending);
  all.then((fns) => {
    if (disposed) fns.forEach((u) => u());
  });
  return () => {
    disposed = true;
    all.then((fns) => fns.forEach((u) => u()));
  };
}
