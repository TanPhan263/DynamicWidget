import { closestCenter, DndContext, KeyboardSensor, useSensor, useSensors, type Announcements } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FieldSafePointerSensor } from "@/lib/dnd";
import { cn } from "@/lib/utils";
import { ALL_WIDGETS, clampSpan, SMALL, widgetLabel, type WidgetId, type WidgetSpan } from "../shared/types";
import { t } from "../shared/i18n";
import { dropWidget, moveWidget, toggleWidget } from "./widgetOrder";

type Sizes = Partial<Record<WidgetId, WidgetSpan>>;

const spanKey = (s: WidgetSpan) => `${s.cols}x${s.rows}`;

/** Every size a widget can take, columns × rows. */
const SPAN_OPTIONS = [1, 2].flatMap((rows) =>
  [1, 2, 3].map((cols) => ({ key: spanKey({ cols, rows }), label: `${cols} × ${rows}` })),
);

interface Props {
  enabled: WidgetId[];
  sizes: Sizes;
  onChange: (widgets: WidgetId[]) => void;
  onSizesChange: (sizes: Sizes) => void;
}

const label = (id: unknown) => widgetLabel(id as WidgetId);

interface RowProps {
  id: WidgetId;
  enabled: WidgetId[];
  sizes: Sizes;
  onChange: (widgets: WidgetId[]) => void;
  onSizesChange: (sizes: Sizes) => void;
}

function RowBody({ id, enabled, sizes, onChange, onSizesChange }: RowProps) {
  const on = enabled.includes(id);
  const index = enabled.indexOf(id);
  return (
    <>
      <Switch
        id={`widget-${id}`}
        aria-label={t("widgets.show", { name: label(id) })}
        checked={on}
        onCheckedChange={() => onChange(toggleWidget(enabled, id))}
      />
      <label htmlFor={`widget-${id}`} className={cn("flex-1 text-sm font-medium", !on && "text-muted-foreground")}>
        {label(id)}
      </label>
      <select
        aria-label={t("widgets.size", { name: label(id) })}
        value={spanKey(sizes[id] ?? SMALL)}
        onChange={(e) => {
          const [cols, rows] = e.target.value.split("x").map(Number);
          onSizesChange({ ...sizes, [id]: clampSpan(cols, rows) });
        }}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {SPAN_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {on && (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("widgets.earlier", { name: label(id) })}
            disabled={index === 0}
            onClick={() => onChange(moveWidget(enabled, id, -1))}
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("widgets.later", { name: label(id) })}
            disabled={index === enabled.length - 1}
            onClick={() => onChange(moveWidget(enabled, id, 1))}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>
      )}
    </>
  );
}

function SortableRow(props: RowProps) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative flex items-center gap-3 border-b bg-card py-3 pr-5 pl-2 last:border-b-0",
        isDragging && "z-10 rounded-lg border-transparent shadow-lg ring-1 ring-border",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("widgets.reorder", { name: label(props.id) })}
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <RowBody {...props} />
    </li>
  );
}

/**
 * Shown widgets come first and can be dragged (or moved with the arrow
 * buttons) into order; hidden widgets follow and only toggle.
 */
export function WidgetList({ enabled, sizes, onChange, onSizesChange }: Props) {
  const hidden = ALL_WIDGETS.filter((w) => !enabled.includes(w));
  const sensors = useSensors(
    useSensor(FieldSafePointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const position = (id: unknown) => enabled.indexOf(id as WidgetId) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.pickedUp", { name: label(active.id), pos: position(active.id), count: enabled.length }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { name: label(active.id), pos: position(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { name: label(active.id), pos: position(over.id) }) : undefined),
    onDragCancel: ({ active }) => t("dnd.cancelled", { name: label(active.id) }),
  };

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{ announcements }}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id) onChange(dropWidget(enabled, active.id as WidgetId, over.id as WidgetId));
        }}
      >
        <SortableContext items={enabled} strategy={verticalListSortingStrategy}>
          <ul>
            {enabled.map((id) => (
              <SortableRow key={id} id={id} enabled={enabled} sizes={sizes} onChange={onChange} onSizesChange={onSizesChange} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {hidden.length > 0 && (
        <ul className={cn(enabled.length > 0 && "border-t")}>
          {hidden.map((id) => (
            <li key={id} className="flex items-center gap-3 border-b py-3 pr-5 pl-11 last:border-b-0">
              <RowBody id={id} enabled={enabled} sizes={sizes} onChange={onChange} onSizesChange={onSizesChange} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
