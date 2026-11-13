import { lookVars } from "./types";

describe("lookVars", () => {
  it("keeps the glass look when nothing is picked", () => {
    expect(lookVars()).toEqual({});
  });

  it("lays a dark veil over a picture, or the picked color at its opacity", () => {
    expect(lookVars({}, "data:x")["--card"]).toBe('linear-gradient(rgb(0 0 0 / 0.35), rgb(0 0 0 / 0.35)), url("data:x") center / cover');
    const veil = "color-mix(in srgb, #ff0000 20%, transparent)";
    expect(lookVars({ background: "#ff0000", opacity: 20 }, "data:x")["--card"]).toBe(`linear-gradient(${veil}, ${veil}), url("data:x") center / cover`);
    expect(lookVars({ background: "#ff0000", opacity: 20 })["--card"]).toBe(veil);
  });

  it("recolors text, accents and inherited text together", () => {
    expect(lookVars({ text: "#00ff00" })).toEqual({ "--color-white": "#00ff00", "--widget-text": "#00ff00", color: "#00ff00" });
  });
});
