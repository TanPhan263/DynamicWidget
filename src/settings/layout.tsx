import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/** A titled group of settings rows. */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="space-y-1 px-1">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{title}</h2>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A card whose rows are separated by hairlines. */
export function RowCard({ children }: { children: ReactNode }) {
  return <Card className="divide-y divide-black/[0.06] overflow-hidden dark:divide-white/[0.06]">{children}</Card>;
}

interface RowProps {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

/** Label and description on the left, control on the right. */
export function Row({ label, description, htmlFor, children }: RowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label htmlFor={htmlFor} className="text-[13px]">
          {label}
        </Label>
        {description && <div className="text-[13px] leading-snug text-muted-foreground">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}
