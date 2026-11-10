import { useEffect, useState } from "react";

/** The panel's glow when nothing tints it: a cool, quiet indigo. */
export const DEFAULT_AMBIENT = "99 102 241";

/** Mean color of an image as "r g b", or null when it can't be read. */
function averageColor(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return lift([r / n, g / n, b / n]);
  } catch {
    return null;
  }
}

/** Dark covers would make no glow; brighten while keeping the hue. */
export function lift([r, g, b]: number[]): string {
  const max = Math.max(r, g, b, 1);
  const k = max < 140 ? 140 / max : 1;
  return [r, g, b].map((v) => Math.round(Math.min(255, v * k))).join(" ");
}

/** The color a cover (a data URL) gives the panel's glow. */
export function useAmbient(src: string | null | undefined): string {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => live && setColor(averageColor(img));
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return color ?? DEFAULT_AMBIENT;
}
