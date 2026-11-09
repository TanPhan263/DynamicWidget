import type { IslandNotification } from "../shared/types";
import { initialState, reduce, viewOf, type Action, type IslandState } from "./islandState";

const n = (id: number): IslandNotification => ({
  id,
  title: `n${id}`,
  body: "",
  app: "Test",
  icon: null,
  image: null,
  symbol: null,
  accent: null,
  source: "api",
  createdAt: 0,
});

const run = (actions: Action[], from: IslandState = initialState) => actions.reduce(reduce, from);
const notify = (id: number, doNotDisturb = false): Action => ({
  type: "notify",
  notification: n(id),
  doNotDisturb,
  trigger: "hover",
});

describe("island view", () => {
  it("is compact at rest", () => {
    expect(viewOf(initialState, "hover")).toBe("compact");
  });

  it("expands on hover only in hover mode", () => {
    const hovered = reduce(initialState, { type: "hover", hover: true, trigger: "hover" });
    expect(viewOf(hovered, "hover")).toBe("expanded");
    const clickMode = reduce(initialState, { type: "hover", hover: true, trigger: "click" });
    expect(viewOf(clickMode, "click")).toBe("compact");
  });

  it("stays open while pinned, even after the pointer leaves", () => {
    const s = run([{ type: "toggle" }, { type: "hover", hover: false, trigger: "hover" }]);
    expect(viewOf(s, "hover")).toBe("expanded");
    expect(viewOf(reduce(s, { type: "toggle" }), "hover")).toBe("compact");
    expect(viewOf(reduce(s, { type: "close" }), "hover")).toBe("compact");
  });
});

describe("notifications", () => {
  it("peek one at a time, in arrival order", () => {
    let s = run([notify(1), notify(2), notify(3)]);
    expect(viewOf(s, "hover")).toBe("peek");
    expect(s.peek?.id).toBe(1);
    expect(s.unread).toBe(3);
    s = reduce(s, { type: "peek-done" });
    expect(s.peek?.id).toBe(2);
    s = run([{ type: "peek-done" }, { type: "peek-done" }], s);
    expect(s.peek).toBeNull();
    expect(viewOf(s, "hover")).toBe("compact");
  });

  it("only counts unread in Do Not Disturb", () => {
    const s = run([notify(1, true), notify(2, true)]);
    expect(s.peek).toBeNull();
    expect(s.unread).toBe(2);
  });

  it("does not peek while the panel is open", () => {
    const s = run([{ type: "toggle" }, notify(1)]);
    expect(s.peek).toBeNull();
    expect(s.unread).toBe(0);
  });

  it("opening the panel clears peeks and unread", () => {
    const s = run([notify(1), notify(2), { type: "open", tab: "notifications" }]);
    expect(s).toMatchObject({ peek: null, queue: [], unread: 0, tab: "notifications", pinned: true });
  });

  it("dismissing the peeking notification shows the next one", () => {
    let s = run([notify(1), notify(2), notify(3), { type: "dismissed", id: 1 }]);
    expect(s.peek?.id).toBe(2);
    s = reduce(s, { type: "dismissed", id: 3 });
    expect(s.queue).toEqual([]);
  });
});
