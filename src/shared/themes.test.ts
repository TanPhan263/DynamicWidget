import { THEME_IDS, themeLook } from "./themes";

it("gives every theme a panel that starts black, to meet the notch", () => {
  for (const id of THEME_IDS) {
    expect(themeLook(id).panel("1 2 3", null)).toMatch(/#000/);
    expect(themeLook(id).panel("1 2 3", "data:image/png;base64,AA")).toMatch(/^(linear-gradient\(180deg, #000|#000|radial)/);
  }
});

it("tints the panel with the cover only where the theme says", () => {
  expect(themeLook("graphite").panel("9 8 7", null)).toContain("rgb(9 8 7");
  expect(themeLook("aurora").panel("9 8 7", null)).not.toContain("rgb(9 8 7");
});

it("shows the picture, darkened, only with the Picture theme", () => {
  const pic = "data:image/jpeg;base64,AAAA";
  expect(themeLook("picture").panel("1 2 3", pic)).toContain(`url("${pic}")`);
  expect(themeLook("picture").island(pic)).toMatch(/rgb\(0 0 0 \/ 0\.45\).*url\(/);
  expect(themeLook("graphite").panel("1 2 3", pic)).not.toContain("url(");
  // Until a picture is saved it looks like Graphite.
  expect(themeLook("picture").panel("1 2 3", null)).toBe(themeLook("graphite").panel("1 2 3", null));
});

it("lets the desktop show through Transparent", () => {
  expect(themeLook("transparent").panel("1 2 3", null)).toMatch(/rgb\(0 0 0 \/ 0\.25\) 100%/);
  expect(themeLook("transparent").island(null)).toBe("rgb(0 0 0 / 0.4)");
});

it("falls back to Graphite for a theme it doesn't know", () => {
  expect(themeLook("neon" as never)).toBe(themeLook("graphite"));
});
