import { CloudDrizzle, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from "lucide-react";
import { weatherIcon } from "./Widgets";

it("picks an icon for each kind of wttr.in condition", () => {
  expect(weatherIcon(113).icon).toBe(Sun);
  expect(weatherIcon(116).icon).toBe(CloudSun);
  expect(weatherIcon(176).icon).toBe(CloudDrizzle);
  expect(weatherIcon(308).icon).toBe(CloudRain);
  expect(weatherIcon(338).icon).toBe(CloudSnow);
  expect(weatherIcon(389).icon).toBe(CloudLightning);
  // Unknown codes still get an icon.
  expect(weatherIcon(999).icon).toBe(CloudRain);
});
