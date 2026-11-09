import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/** A titled group of settings rows. */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A card whose rows are separated by hairlines. */
export function RowCard({ children }: { children: ReactNode }) {
  return <Card className="divide-y overflow-hidden">{children}</Card>;
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
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  );
}
