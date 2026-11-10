import { useEffect, useState } from "react";
import { getBackgroundImage } from "./commands";
import { listenAll } from "./events";
import type { BackgroundSlot } from "./types";

export type Pictures = Record<BackgroundSlot, string | null>;

/** The saved background pictures (data URLs), kept current across windows. */
export function useBackgroundImages(): Pictures {
  const [pictures, setPictures] = useState<Pictures>({ panel: null, island: null });
  useEffect(() => {
    const set = (slot: BackgroundSlot, image: string | null) => setPictures((p) => ({ ...p, [slot]: image }));
    for (const slot of ["panel", "island"] as const) {
      getBackgroundImage(slot)
        .then((i) => set(slot, i ?? null))
        .catch(() => {});
    }
    return listenAll({ "background-changed": ({ slot, image }) => set(slot, image) });
  }, []);
  return pictures;
}

/**
 * Reads a picture the user chose as a data URL (the pages' CSP only allows
 * `data:` images, not blob URLs); Settings then crops it to the slot's shape.
 */
export function readPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}
