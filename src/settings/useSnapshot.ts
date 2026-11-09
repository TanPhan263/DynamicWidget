import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot, saveSettings } from "../shared/commands";
import { listenAll } from "../shared/events";
import { errorMessage, validateSettings, type Settings, type UiSnapshot } from "../shared/types";

/**
 * Holds the core snapshot and keeps it in sync with core events. Settings
 * edits are applied optimistically and rolled back if the core rejects them.
 */
export function useSnapshot() {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapRef = useRef<UiSnapshot | null>(null);
  snapRef.current = snap;

  const reload = useCallback(async () => {
    try {
      setSnap(await getSnapshot());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    reload();
    return listenAll({
      "settings-changed": () => reload(),
      "state-changed": () => reload(),
      "shortcut-conflict": (message) => {
        setError(message);
        reload();
      },
    });
  }, [reload]);

  const update = useCallback(
    async (patch: Partial<Settings>): Promise<boolean> => {
      const current = snapRef.current;
      if (!current) return false;
      const next = { ...current.settings, ...patch };
      const invalid = validateSettings(next);
      if (invalid) {
        setError(invalid);
        return false;
      }
      setSnap({ ...current, settings: next });
      try {
        setSnap(await saveSettings(next));
        setError(null);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        await reload();
        return false;
      }
    },
    [reload],
  );

  const run = useCallback(async (action: () => Promise<UiSnapshot | unknown>) => {
    try {
      const result = await action();
      if (result && typeof result === "object" && "settings" in result) setSnap(result as UiSnapshot);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  return { snap, error, setError, update, run, reload };
}

export type SnapshotApi = ReturnType<typeof useSnapshot>;
