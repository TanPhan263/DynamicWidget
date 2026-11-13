import { moveIcon, zonesOf } from "./IslandIcons";

describe("moveIcon", () => {
  const zones = zonesOf({ left: ["cpu"], right: ["memory"] });

  it("moves an icon from the tray onto an empty side or beside another icon", () => {
    expect(zones.tray).toEqual(["time", "date", "disk", "battery", "weather", "mail"]);
    const tray = ["time", "date", "disk", "weather", "mail"];
    expect(moveIcon(zones, "battery", "left")).toEqual({ left: ["cpu", "battery"], right: ["memory"], tray });
    expect(moveIcon(zones, "battery", "memory")).toEqual({ left: ["cpu"], right: ["battery", "memory"], tray });
  });

  it("reorders within a side and takes an icon back off the island", () => {
    const both = moveIcon(zones, "memory", "cpu");
    expect(both.left).toEqual(["memory", "cpu"]);
    expect(moveIcon(both, "memory", "cpu").left).toEqual(["cpu", "memory"]);
    expect(moveIcon(zones, "cpu", "tray")).toEqual({ left: [], right: ["memory"], tray: ["time", "date", "disk", "battery", "weather", "mail", "cpu"] });
  });

  it("takes no more than four icons from the tray", () => {
    const four = zonesOf({ left: ["cpu", "memory"], right: ["disk", "battery"] });
    expect(moveIcon(four, "mail", "left")).toBe(four);
    // Moving along the island still works.
    expect(moveIcon(four, "cpu", "right").right).toEqual(["disk", "battery", "cpu"]);
  });

  it("offers only the icons this computer can show", () => {
    expect(zonesOf({ left: [], right: [] }, ["cpu", "battery"]).tray).toEqual(["cpu", "battery"]);
  });

  it("keeps a side beside the notch to what its wing fits", () => {
    const two = zonesOf({ left: ["cpu", "memory"], right: [] });
    expect(moveIcon(two, "disk", "left", true)).toBe(two);
    expect(moveIcon(two, "time", "right", true).right).toEqual(["time"]);
    // Without a notch there is one row, so only the total limit applies.
    expect(moveIcon(two, "disk", "left").left).toEqual(["cpu", "memory", "disk"]);
  });
});
