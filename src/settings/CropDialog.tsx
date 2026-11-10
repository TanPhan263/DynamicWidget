import { ZoomIn, ZoomOut } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { BackgroundSlot } from "../shared/types";
import {
  centered,
  clampOffset,
  CROP_ASPECT,
  CROP_WIDTH,
  displayScale,
  MAX_ZOOM,
  sourceRect,
  zoomAround,
  type Point,
  type Size,
} from "./crop";

/** Frame width on screen; its height follows the slot's shape. */
const FRAME_WIDTH = 440;
/** Room around the frame (x, y) where the rest of the picture shows dimmed; the thin pill gets more above and below. */
const MARGIN: Record<BackgroundSlot, Point> = { panel: { x: 20, y: 20 }, island: { x: 20, y: 56 } };
const PAN_STEP = 12;

interface Props {
  slot: BackgroundSlot;
  /** The picture as a data URL. */
  src: string;
  onCancel: () => void;
  /** The cropped picture as a JPEG data URL. */
  onSave: (image: string) => void;
  onError: (message: string) => void;
}

/** Frames a picture to the panel's or the island's shape before it is saved. */
export function CropDialog({ slot, src, onCancel, onSave, onError }: Props) {
  const frame: Size = { width: FRAME_WIDTH, height: Math.round(FRAME_WIDTH / CROP_ASPECT[slot]) };
  const margin = MARGIN[slot];
  const img = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      img.current = image;
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      setNatural(size);
      setZoom(1);
      setOffset(centered(size, frame, displayScale(size, frame, 1)));
    };
    image.onerror = () => onError("That file isn't a picture this app can show. Try a JPEG or PNG.");
    image.src = src;
    // A new picture or shape starts over.
  }, [src, slot]);

  const scale = natural ? displayScale(natural, frame, zoom) : 1;
  const move = (next: Point, s = scale) => natural && setOffset(clampOffset(next, natural, frame, s));
  const zoomTo = (z: number) => {
    if (!natural) return;
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const to = displayScale(natural, frame, next);
    setZoom(next);
    move(zoomAround(offset, frame, scale, to), to);
  };

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    move({ x: offset.x + dx, y: offset.y + dy });
  };
  const onWheel = (e: WheelEvent) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] }[e.key];
    if (!step) return;
    e.preventDefault();
    move({ x: offset.x + step[0], y: offset.y + step[1] });
  };

  const save = () => {
    if (!img.current || !natural) return;
    const r = sourceRect(offset, frame, scale);
    const canvas = document.createElement("canvas");
    canvas.width = CROP_WIDTH[slot];
    canvas.height = Math.round(CROP_WIDTH[slot] / CROP_ASPECT[slot]);
    const ctx = canvas.getContext("2d");
    if (!ctx) return onError("This window can't prepare pictures.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.current, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
    onSave(canvas.toDataURL("image/jpeg", 0.85));
  };

  const layer = (dim: boolean) =>
    natural && (
      <img
        src={src}
        alt=""
        draggable={false}
        className={cn("pointer-events-none absolute max-w-none select-none", dim && "opacity-35")}
        style={{
          left: offset.x + (dim ? margin.x : 0),
          top: offset.y + (dim ? margin.y : 0),
          width: natural.width * scale,
          height: natural.height * scale,
        }}
      />
    );

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border bg-card p-5 shadow-2xl outline-none">
          <div className="space-y-1">
            <Dialog.Title className="text-base font-semibold tracking-tight">
              {slot === "panel" ? "Frame the panel picture" : "Frame the island picture"}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground">
              Drag to move it, scroll or use the slider to zoom. Only what's inside the{" "}
              {slot === "panel" ? "frame" : "pill"} is kept.
            </Dialog.Description>
          </div>

          <div
            role="application"
            aria-label="Picture position; use the arrow keys to move it"
            tabIndex={0}
            className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-xl bg-neutral-950 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
            style={{ width: frame.width + margin.x * 2, height: frame.height + margin.y * 2 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
          >
            {/* The rest of the picture, dimmed, around the frame. */}
            {layer(true)}
            <div
              className={cn(
                "absolute overflow-hidden ring-2 ring-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]",
                slot === "panel" ? "rounded-[18px]" : "rounded-full",
              )}
              style={{ left: margin.x, top: margin.y, width: frame.width, height: frame.height }}
            >
              {layer(false)}
            </div>
          </div>

          <div className="flex items-center gap-3 px-1">
            <ZoomOut className="size-4 text-muted-foreground" aria-hidden="true" />
            <Slider aria-label="Zoom" min={1} max={MAX_ZOOM} step={0.01} value={[zoom]} onValueChange={([z]) => zoomTo(z)} />
            <ZoomIn className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!natural}>
              Use picture
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
