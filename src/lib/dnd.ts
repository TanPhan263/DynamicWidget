import { PointerSensor } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Pointer sensor that ignores presses inside text fields, so selecting text
 * in a widget never starts a drag.
 */
export class FieldSafePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent) => {
        const target = nativeEvent.target as HTMLElement | null;
        return nativeEvent.isPrimary && nativeEvent.button === 0 && !target?.closest("textarea, input, [data-no-drag]");
      },
    },
  ];
}
