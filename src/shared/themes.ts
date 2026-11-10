import type { IslandTheme } from "./types";

export interface ThemeLook {
  label: string;
  /** The floating island's background (CSS). The notch style stays black to match the notch. */
  island: (picture: string | null, fit?: string) => string;
  /**
   * The open panel's background (CSS); `ambient` is the cover's "r g b" and
   * `picture` the user's background picture. Black at the top, where it meets the notch.
   */
  panel: (ambient: string, picture: string | null) => string;
}

const coverWash = (ambient: string, alpha: number) => `radial-gradient(90% 55% at 50% 110%, rgb(${ambient} / ${alpha}), transparent 70%)`;
const graphitePanel = (a: string) => `${coverWash(a, 0.14)}, linear-gradient(180deg, #000 0%, #0b0b0d 45%, #111114 100%)`;
/** A CSS layer for a data URL; the quotes keep its characters from ending the value. */
const photo = (picture: string, fit = "center / cover no-repeat") => `url("${picture}") ${fit}`;

export const THEMES: Record<IslandTheme, ThemeLook> = {
  graphite: {
    label: "Graphite",
    island: () => "#000",
    panel: graphitePanel,
  },
  black: {
    label: "Black",
    island: () => "#000",
    panel: () => "#000",
  },
  midnight: {
    label: "Midnight",
    island: () => "#0a1024",
    panel: (a) => `${coverWash(a, 0.12)}, linear-gradient(180deg, #000 0%, #070b1a 40%, #0e1836 100%)`,
  },
  aurora: {
    label: "Aurora",
    island: () => "#061114",
    panel: () =>
      "radial-gradient(60% 50% at 12% 90%, rgb(45 212 191 / 0.22), transparent 70%), radial-gradient(55% 50% at 92% 70%, rgb(167 139 250 / 0.24), transparent 70%), linear-gradient(180deg, #000 0%, #05080b 100%)",
  },
  ember: {
    label: "Ember",
    island: () => "#160b06",
    panel: () => "radial-gradient(90% 60% at 50% 115%, rgb(251 146 60 / 0.24), transparent 70%), linear-gradient(180deg, #000 0%, #120a06 55%, #1f0f08 100%)",
  },
  slate: {
    label: "Slate",
    island: () => "#1c1d22",
    panel: (a) => `${coverWash(a, 0.12)}, linear-gradient(180deg, #000 0%, #1a1b20 35%, #25272e 100%)`,
  },
  transparent: {
    label: "Transparent",
    // Nearly clear so the desktop shows through; the tiles' own dark layer keeps text readable.
    island: () => "rgb(0 0 0 / 0.4)",
    panel: () => "linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.3) 12%, rgb(0 0 0 / 0.25) 100%)",
  },
  picture: {
    label: "Picture",
    // Darkened so text and controls stay readable over any picture; Graphite until one is chosen.
    island: (p, fit) => (p ? `linear-gradient(rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.45)), ${photo(p, fit)}` : "#000"),
    panel: (a, p) =>
      p
        ? `linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.6) 14%, rgb(0 0 0 / 0.35) 55%, rgb(0 0 0 / 0.5) 100%), ${photo(p)}, #000`
        : graphitePanel(a),
  },
};

export const THEME_IDS = Object.keys(THEMES) as IslandTheme[];

/** A saved theme the page doesn't know (from a newer version) looks like Graphite. */
export const themeLook = (id: IslandTheme | undefined): ThemeLook => THEMES[id ?? "graphite"] ?? THEMES.graphite;
