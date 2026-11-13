import type { ExpandTrigger, IslandNotification } from "../shared/types";
import type { View } from "./geometry";

// What the island shows is decided here, as a pure reducer:
// - expanded: pinned open (click or shortcut), or hovered in hover mode
// - peek: a new notification is on display for a few seconds
// - compact: otherwise

export type Tab = "widgets" | "notifications";

export interface IslandState {
  hover: boolean;
  pinned: boolean;
  tab: Tab;
  /** Notification currently popping out of the island. */
  peek: IslandNotification | null;
  /** Notifications waiting for their turn to peek. */
  queue: IslandNotification[];
  /** Arrived since the panel was last opened. */
  unread: number;
}

export type Action =
  | { type: "hover"; hover: boolean; trigger: ExpandTrigger }
  | { type: "toggle" }
  | { type: "open"; tab?: Tab }
  | { type: "close" }
  | { type: "tab"; tab: Tab }
  | { type: "notify"; notification: IslandNotification; doNotDisturb: boolean; trigger: ExpandTrigger }
  | { type: "media"; notification: IslandNotification; doNotDisturb: boolean; trigger: ExpandTrigger }
  | { type: "peek-done" }
  | { type: "dismissed"; id: number };

export const initialState: IslandState = {
  hover: false,
  pinned: false,
  tab: "widgets",
  peek: null,
  queue: [],
  unread: 0,
};

export function viewOf(s: IslandState, trigger: ExpandTrigger): View {
  if (s.pinned || (s.hover && trigger === "hover")) return "expanded";
  if (s.peek) return "peek";
  return "compact";
}

/** Opening the panel shows every notification, so pending peeks are dropped. */
function opened(s: IslandState, tab?: Tab): IslandState {
  return { ...s, tab: tab ?? s.tab, peek: null, queue: [], unread: 0 };
}

export function reduce(s: IslandState, a: Action): IslandState {
  switch (a.type) {
    case "hover": {
      const next = { ...s, hover: a.hover };
      return a.hover && a.trigger === "hover" && !s.pinned ? opened(next) : next;
    }
    case "toggle":
      return s.pinned ? { ...s, pinned: false } : opened({ ...s, pinned: true });
    case "open":
      return opened({ ...s, pinned: true }, a.tab);
    case "close":
      // Forgets the hover too, so the panel closes under the pointer; it opens
      // again once the pointer leaves and comes back.
      return { ...s, pinned: false, hover: false };
    case "tab":
      return { ...s, tab: a.tab };
    case "notify": {
      if (viewOf(s, a.trigger) === "expanded") return { ...s, unread: 0 };
      const unread = s.unread + 1;
      if (a.doNotDisturb) return { ...s, unread };
      if (!s.peek) return { ...s, peek: a.notification, unread };
      return { ...s, queue: [...s.queue, a.notification], unread };
    }
    case "media":
      // The title of a new track peeks once; it is not a notification, so
      // it adds nothing to the unread count and waits for nothing.
      if (a.doNotDisturb || s.peek || viewOf(s, a.trigger) === "expanded") return s;
      return { ...s, peek: a.notification };
    case "peek-done": {
      const [next, ...rest] = s.queue;
      return { ...s, peek: next ?? null, queue: rest };
    }
    case "dismissed": {
      const queue = s.queue.filter((n) => n.id !== a.id);
      if (s.peek?.id === a.id) {
        const [next, ...rest] = queue;
        return { ...s, peek: next ?? null, queue: rest };
      }
      return { ...s, queue };
    }
  }
}
