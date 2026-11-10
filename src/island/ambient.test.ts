import { lift } from "./ambient";

it("brightens dark covers but keeps their hue", () => {
  expect(lift([70, 10, 20])).toBe("140 20 40");
  expect(lift([200, 100, 50])).toBe("200 100 50");
  expect(lift([0, 0, 0])).toBe("0 0 0");
});
