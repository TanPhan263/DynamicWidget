import { useEffect, useState } from "react";
import { captureAccelerator, formatAccelerator } from "@/features/shortcuts/accelerator";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { t } from "@/shared/i18n";
import { Kbd } from "./ui/kbd";

interface Props {
  id?: string;
  value: string;
  isMac: boolean;
  /** Another shortcut, to block duplicates before they reach the core. */
  otherValue?: string;
  onChange: (accelerator: string) => void;
}

/** Click, then press keys to record a global shortcut. */
export function ShortcutInput({ id, value, isMac, otherValue, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = captureAccelerator(e, isMac);
      if (r.kind === "pending") return;
      if (r.kind === "cancel") {
        setRecording(false);
        setHint(null);
        return;
      }
      if (r.kind === "error") {
        setHint(r.message);
        return;
      }
      if (otherValue && r.accelerator.toLowerCase() === otherValue.toLowerCase()) {
        setHint(t("shortcut.conflict"));
        return;
      }
      setRecording(false);
      setHint(null);
      if (r.accelerator !== value) onChange(r.accelerator);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, isMac, otherValue, value, onChange]);

  const keys = formatAccelerator(value, isMac);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        id={id}
        variant="outline"
        size="sm"
        className={cn("min-w-32", recording && "border-ring ring-[3px] ring-ring/30")}
        onClick={() => {
          setRecording((r) => !r);
          setHint(null);
        }}
        onBlur={() => setRecording(false)}
        aria-live="polite"
      >
        {recording ? (
          <span className="text-muted-foreground">{t("shortcut.recording")}</span>
        ) : (
          <Kbd className="bg-transparent px-0 text-foreground">{keys}</Kbd>
        )}
      </Button>
      {hint && <p className="max-w-60 text-right text-xs text-destructive">{hint}</p>}
    </div>
  );
}
