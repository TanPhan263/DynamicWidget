import { dropWidget, moveWidget, toggleWidget } from "./widgetOrder";

describe("widget order", () => {
  it("toggles widgets on at the end", () => {
    expect(toggleWidget(["clock"], "notes")).toEqual(["clock", "notes"]);
    expect(toggleWidget(["clock", "notes"], "clock")).toEqual(["notes"]);
  });

  it("moves within bounds", () => {
    expect(moveWidget(["clock", "timer", "notes"], "timer", -1)).toEqual(["timer", "clock", "notes"]);
    expect(moveWidget(["clock", "timer"], "clock", -1)).toEqual(["clock", "timer"]);
    expect(moveWidget(["clock", "timer"], "timer", 1)).toEqual(["clock", "timer"]);
    expect(moveWidget(["clock"], "notes", 1)).toEqual(["clock"]);
  });
});

describe("dropWidget", () => {
  it("moves the dragged widget to the drop position", () => {
    expect(dropWidget(["clock", "calendar", "timer", "system"], "timer", "clock")).toEqual(["timer", "clock", "calendar", "system"]);
    expect(dropWidget(["clock", "calendar", "timer", "system"], "clock", "timer")).toEqual(["calendar", "timer", "clock", "system"]);
  });

  it("ignores drops on itself or on widgets that are not shown", () => {
    expect(dropWidget(["clock", "timer"], "clock", "clock")).toEqual(["clock", "timer"]);
    expect(dropWidget(["clock", "timer"], "clock", "notes")).toEqual(["clock", "timer"]);
  });
});
