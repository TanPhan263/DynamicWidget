import { act, render, screen, within } from "@testing-library/react";
import { baseSnapshot, invoked, resetMock } from "../../test/tauriMock";
import { CountdownsWidget, daysUntil, EventsWidget, timeLeft } from "./Widgets";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/tauriMock")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/tauriMock")).eventModule);

const flush = () => act(async () => {});

describe("Events widget", () => {
  it("asks for a calendar link when there is none, without fetching", async () => {
    resetMock();
    render(<EventsWidget links={[]} now={new Date()} use24={false} />);
    await flush();
    expect(screen.getByText("Add a calendar link in Settings → Widgets.")).toBeInTheDocument();
    expect(invoked.some((c) => c.cmd === "get_events")).toBe(false);
  });

  it("marks what is going on now and names the calendar when there are several", async () => {
    const snap = baseSnapshot();
    snap.settings.calendarLinks = ["https://a.example/x.ics", "https://b.example/y.ics"];
    resetMock(snap);
    // The mock's first event runs 9:00–10:00 UTC, the second 10:00–11:00.
    render(<EventsWidget links={snap.settings.calendarLinks} now={new Date(Date.UTC(2026, 10, 12, 9, 30))} use24 />);
    await flush();
    const first = screen.getByText("Event 1").closest("li")!;
    expect(within(first).getByText("Now")).toBeInTheDocument();
    expect(within(first).getByText("Room 1 · Work")).toBeInTheDocument();
    const second = screen.getByText("Event 2").closest("li")!;
    expect(within(second).queryByText("Now")).toBeNull();
  });

  it("drops events once they end", async () => {
    const snap = baseSnapshot();
    snap.settings.calendarLinks = ["https://a.example/x.ics"];
    resetMock(snap);
    render(<EventsWidget links={snap.settings.calendarLinks} now={new Date(Date.UTC(2026, 10, 12, 10, 1))} use24 />);
    await flush();
    expect(screen.queryByText("Event 1")).toBeNull();
    expect(screen.getByText("Nothing in the next 30 days.")).toBeInTheDocument();
  });

  it("says why nothing loaded", async () => {
    const snap = baseSnapshot();
    snap.settings.calendarLinks = ["https://bad.example/x.ics"];
    resetMock(snap);
    render(<EventsWidget links={snap.settings.calendarLinks} now={new Date()} use24={false} />);
    await flush();
    expect(screen.getByText("this address is not a calendar link")).toBeInTheDocument();
  });
});

describe("Countdowns widget", () => {
  const now = new Date(2026, 10, 12, 18);

  it("counts whole days on this computer's calendar", () => {
    expect(daysUntil("2026-11-12", now)).toBe(0);
    expect(daysUntil("2026-11-13", new Date(2026, 10, 12, 23, 59))).toBe(1);
    expect(daysUntil("2027-01-01", now)).toBe(50);
    expect(daysUntil("2026-11-10", now)).toBe(-2);
  });

  it("shows the nearest day large, then the rest in order", () => {
    render(
      <CountdownsWidget
        now={now}
        countdowns={[
          { name: "Old", date: "2026-11-10" },
          { name: "Trip", date: "2026-11-20" },
          { name: "Launch", date: "2026-11-15" },
        ]}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("days")).toBeInTheDocument();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["Tripin 8 days", "Old2 days ago"]);
  });

  it("splits the time left into days and h:mm:ss, until the day begins", () => {
    const at = new Date(2026, 10, 12, 19, 30, 5);
    expect(timeLeft("2026-11-15", at)).toEqual({ days: 2, hours: 4, minutes: 29, seconds: 55, clock: "04:29:55" });
    expect(timeLeft("2026-11-13", at)).toMatchObject({ days: 0, clock: "04:29:55" });
    expect(timeLeft("2026-11-12", at)).toBeNull();
  });

  it("shows live days, hours, minutes and seconds when the card is bigger", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 12, 19, 30, 5));
    onTestFinished(() => void vi.useRealTimers());
    render(<CountdownsWidget now={new Date(2026, 10, 12, 19, 30, 5)} span={{ cols: 2, rows: 1 }} countdowns={[{ name: "Launch", date: "2026-11-15" }]} />);
    expect(screen.getByRole("timer")).toHaveAccessibleName("2 days, 4 hours, 29 minutes, 55 seconds");
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });

  it("asks for dates when there are none", () => {
    render(<CountdownsWidget now={now} countdowns={[]} />);
    expect(screen.getByText("Add dates in Settings → Widgets.")).toBeInTheDocument();
  });
});
