import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpRight, GripVertical } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { FieldSafePointerSensor } from "@/lib/dnd";
import { cn } from "@/lib/utils";
import { dropWidget } from "../settings/widgetOrder";
import { clampSpan, lookVars, SMALL, widgetLabel, type WidgetId, type WidgetLook, type WidgetSpan } from "../shared/types";
import { t } from "../shared/i18n";
import { CARD_HEIGHT, GAP, WIDGET_COLUMNS } from "./geometry";

const label = (id: unknown) => widgetLabel(id as WidgetId);

/** Card controls appear on hover or keyboard focus. */
const control =
  "grid place-items-center rounded-md text-white/70 opacity-0 transition-opacity outline-none group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40";

interface ResizeProps {
  id: WidgetId;
  span: WidgetSpan;
  /** `done` is false while the pointer is still down. */
  onResize: (span: WidgetSpan, done: boolean) => void;
  onActive: (active: boolean) => void;
}

/**
 * Bottom-right corner handle. Dragging snaps the card to whole grid cells
 * and the grid reflows live; arrow keys do the same from the keyboard.
 */
function ResizeHandle({ id, span, onResize, onActive }: ResizeProps) {
  const start = useRef<{ x: number; y: number; span: WidgetSpan; colUnit: number; rowUnit: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grid = e.currentTarget.closest<HTMLElement>("[data-widget-grid]");
    if (!grid) return;
    // Measure in the same space as the pointer, which also absorbs the
    // island's zoom.
    const rect = grid.getBoundingClientRect();
    const scale = grid.offsetWidth > 0 ? rect.width / grid.offsetWidth : 1;
    const cell = (grid.offsetWidth - (WIDGET_COLUMNS - 1) * GAP) / WIDGET_COLUMNS;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      span,
      colUnit: (cell + GAP) * scale,
      rowUnit: (CARD_HEIGHT + GAP) * scale,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setActive(true);
    onActive(true);
  };

  const spanAt = (e: PointerEvent) => {
    const s = start.current!;
    return clampSpan(s.span.cols + (e.clientX - s.x) / s.colUnit, s.span.rows + (e.clientY - s.y) / s.rowUnit);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!start.current) return;
    const next = spanAt(e);
    if (next.cols !== span.cols || next.rows !== span.rows) onResize(next, false);
  };

  const finish = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    if (!start.current) return;
    const next = cancelled ? start.current.span : spanAt(e);
    start.current = null;
    setActive(false);
    onActive(false);
    onResize(next, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const next = clampSpan(span.cols + d[0], span.rows + d[1]);
    if (next.cols !== span.cols || next.rows !== span.rows) onResize(next, true);
  };

  return (
    <>
      <button
        type="button"
        data-no-drag
        aria-label={t("grid.resize", { name: label(id), cols: span.cols, rows: span.rows })}
        title={t("grid.dragResize")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onKeyDown={onKeyDown}
        className={cn(control, "absolute right-1 bottom-1 size-5 cursor-nwse-resize touch-none", active && "opacity-100")}
      >
        {/* Corner arc, like a resize grip on a rounded card. */}
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
          <path d="M11 3v2a6 6 0 0 1-6 6H3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {active && (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-black tabular-nums"
          >
            {span.cols} × {span.rows}
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

/** Clicks on these do their own thing instead of opening the app. */
const INTERACTIVE = "button, a, input, textarea, select, [contenteditable], [role=button]";

interface SortableProps {
  id: WidgetId;
  span: WidgetSpan;
  look?: WidgetLook;
  /** The widget's own picture, a data URL. */
  picture?: string;
  resizing: boolean;
  /** The app a click opens, if any. */
  app: string | null;
  onOpen: () => void;
  /** True right after a drag, whose release also fires a click. */
  justDragged: () => boolean;
  onResize: (span: WidgetSpan, done: boolean) => void;
  onResizing: (active: boolean) => void;
  children: ReactNode;
}

function SortableWidget({ id, span, look, picture, resizing, app, onOpen, justDragged, onResize, onResizing, children }: SortableProps) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  // Memoized: with a picture this is a long string, and dragging redraws often.
  const vars = useMemo(() => lookVars(look, picture), [look, picture]);
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        gridColumn: `span ${span.cols}`,
        gridRow: `span ${span.rows}`,
        ...vars,
      } as CSSProperties}
      data-card={vars["--card"] ? "" : undefined}
      // The whole card drags with the pointer; the grip is the keyboard handle.
      // A click that is not a drag opens the widget's app.
      onPointerDown={(e) => listeners?.onPointerDown?.(e)}
      onClick={(e) => {
        if (!app || justDragged() || (e.target as Element).closest(INTERACTIVE)) return;
        onOpen();
      }}
      title={app ? t("grid.openHint", { app }) : undefined}
      className={cn("group relative grid cursor-grab", isDragging && "z-10 cursor-grabbing")}
    >
      <div
        className={cn(
          "grid rounded-[18px] transition-[scale,box-shadow] duration-200",
          isDragging && "scale-[1.04] shadow-[0_20px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/20",
          resizing && "ring-1 ring-white/30",
        )}
      >
        {children}
      </div>
      {app && (
        <button
          type="button"
          data-no-drag
          aria-label={t("grid.open", { app })}
          onClick={onOpen}
          className={cn(control, "absolute top-2 right-8 size-5")}
        >
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      )}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        onKeyDown={(e) => listeners?.onKeyDown?.(e)}
        aria-label={t("grid.move", { name: label(id) })}
        className={cn(control, "absolute top-2 right-2 size-5")}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
      <ResizeHandle id={id} span={span} onResize={onResize} onActive={onResizing} />
    </div>
  );
}

interface Props {
  widgets: WidgetId[];
  sizes: Partial<Record<WidgetId, WidgetSpan>>;
  looks?: Partial<Record<WidgetId, WidgetLook>>;
  pictures?: Partial<Record<WidgetId, string>>;
  render: (id: WidgetId, span: WidgetSpan) => ReactNode;
  onReorder: (widgets: WidgetId[]) => void;
  onResize: (id: WidgetId, span: WidgetSpan, done: boolean) => void;
  /** True while a card is being moved or resized with the pointer. */
  onDragging: (dragging: boolean) => void;
  /** More rows than the panel shows; they scroll inside it. */
  scroll: boolean;
  /** The app each widget opens, or null for none. */
  appFor: (id: WidgetId) => string | null;
  onOpen: (id: WidgetId) => void;
}

/** The widget grid: drag a card to reorder, drag its corner to resize. */
export function WidgetGrid({ widgets, sizes, looks = {}, pictures = {}, render, onReorder, onResize, onDragging, scroll, appFor, onOpen }: Props) {
  const [resizing, setResizing] = useState<WidgetId | null>(null);
  // The click that ends a drag arrives right after the drop, so this stays
  // set until the next task.
  const dragged = useRef(false);
  const dragDone = () => setTimeout(() => (dragged.current = false), 0);
  const sensors = useSensors(
    useSensor(FieldSafePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const position = (id: unknown) => widgets.indexOf(id as WidgetId) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.pickedUp", { name: label(active.id), pos: position(active.id), count: widgets.length }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { name: label(active.id), pos: position(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { name: label(active.id), pos: position(over.id) }) : undefined),
    onDragCancel: ({ active }) => t("dnd.cancelled", { name: label(active.id) }),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    onDragging(false);
    dragDone();
    if (over && active.id !== over.id) onReorder(dropWidget(widgets, active.id as WidgetId, over.id as WidgetId));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      accessibility={{ announcements }}
      onDragStart={() => {
        dragged.current = true;
        onDragging(true);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        onDragging(false);
        dragDone();
      }}
    >
      <SortableContext items={widgets} strategy={rectSortingStrategy}>
        <motion.div
          data-widget-grid
          // Only scrollable when needed: the zoomed panel can be a fraction
          // of a pixel shorter than its rows, which would show a scrollbar.
          className={cn(
            "grid min-h-0 flex-1 auto-rows-[132px] grid-cols-3 gap-2.5",
            scroll ? "thin-scroll overflow-y-auto" : "overflow-hidden",
          )}
          initial="hidden"
          animate="shown"
          transition={{ staggerChildren: 0.04, delayChildren: 0.05 }}
        >
          {widgets.map((id) => {
            const span = sizes[id] ?? SMALL;
            return (
              <SortableWidget
                key={id}
                id={id}
                span={span}
                look={looks[id]}
                picture={pictures[id]}
                resizing={resizing === id}
                app={appFor(id)}
                onOpen={() => onOpen(id)}
                justDragged={() => dragged.current}
                onResize={(next, done) => onResize(id, next, done)}
                onResizing={(active) => {
                  setResizing(active ? id : null);
                  onDragging(active);
                }}
              >
                {render(id, span)}
              </SortableWidget>
            );
          })}
        </motion.div>
      </SortableContext>
    </DndContext>
  );
}
