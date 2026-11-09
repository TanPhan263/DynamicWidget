export interface Day {
  date: number;
  inMonth: boolean;
  isToday: boolean;
}

/**
 * Six weeks of days covering `month` (0-11) of `year`, starting on Sunday,
 * so the grid height never changes between months.
 */
export function monthGrid(year: number, month: number, today: Date): Day[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const days: Day[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({
      date: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday:
        d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate(),
    });
  }
  return days;
}
