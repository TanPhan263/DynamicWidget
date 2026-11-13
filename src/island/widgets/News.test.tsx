import { act, fireEvent, render, screen } from "@testing-library/react";
import { baseSnapshot, invoked, resetMock } from "../../test/tauriMock";
import { NewsWidget } from "./Widgets";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/tauriMock")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/tauriMock")).eventModule);

const flush = () => act(async () => {});
const now = new Date(Date.UTC(2026, 10, 12, 10));

describe("News widget", () => {
  it("asks for sites when none are followed, without fetching", async () => {
    resetMock();
    render(<NewsWidget feeds={[]} now={now} />);
    await flush();
    expect(screen.getByText("Add news sites in Settings → Widgets.")).toBeInTheDocument();
    expect(invoked.some((c) => c.cmd === "get_news")).toBe(false);
  });

  it("lists headlines and opens one in the browser", async () => {
    const snap = baseSnapshot();
    snap.settings.newsFeeds = ["https://ex.com"];
    resetMock(snap);
    render(<NewsWidget feeds={snap.settings.newsFeeds} now={now} />);
    await flush();
    expect(screen.getByText(/2 hr\. ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Headline 1/ }));
    await flush();
    expect(invoked).toContainEqual({ cmd: "open_news_link", args: { url: "https://ex.com/story" } });
  });

  it("shows why nothing loaded", async () => {
    const snap = baseSnapshot();
    snap.settings.newsFeeds = ["https://bad.example"];
    resetMock(snap);
    render(<NewsWidget feeds={snap.settings.newsFeeds} now={now} />);
    await flush();
    expect(screen.getByText("no news feed found at this address")).toBeInTheDocument();
  });

  it("plays the stories as slides, holds on pause and opens one", async () => {
    vi.useFakeTimers();
    try {
      const snap = baseSnapshot();
      snap.settings.newsFeeds = ["https://a.example", "https://b.example"];
      resetMock(snap);
      const { container } = render(<NewsWidget feeds={snap.settings.newsFeeds} view="slides" now={now} span={{ cols: 2, rows: 1 }} />);
      await flush();
      const current = () => screen.getByRole("button", { name: /^Story \d of 2/ }).getAttribute("aria-label");
      expect(current()).toBe("Story 1 of 2: Headline 1");
      expect(screen.getByText("Summary 1")).toBeInTheDocument();
      expect(container.querySelector("img")).toHaveAttribute("src", "https://img.example/1.jpg");

      await act(async () => vi.advanceTimersByTime(6000));
      await act(async () => vi.advanceTimersByTime(600));
      expect(current()).toBe("Story 2 of 2: Headline 2");

      fireEvent.click(screen.getByRole("button", { name: "Pause slides" }));
      await act(async () => vi.advanceTimersByTime(20_000));
      expect(current()).toBe("Story 2 of 2: Headline 2");

      // Next wraps around; Previous and the arrow keys step back.
      fireEvent.click(screen.getByRole("button", { name: "Next story" }));
      await act(async () => vi.advanceTimersByTime(600));
      expect(current()).toBe("Story 1 of 2: Headline 1");
      fireEvent.click(screen.getByRole("button", { name: "Previous story" }));
      await act(async () => vi.advanceTimersByTime(600));
      expect(current()).toBe("Story 2 of 2: Headline 2");
      fireEvent.keyDown(screen.getByRole("button", { name: "Previous story" }), { key: "ArrowRight" });
      await act(async () => vi.advanceTimersByTime(600));
      expect(current()).toBe("Story 1 of 2: Headline 1");

      fireEvent.click(screen.getByRole("button", { name: "Show story 1" }));
      await act(async () => vi.advanceTimersByTime(600));
      fireEvent.click(screen.getByRole("button", { name: /^Story 1 of 2/ }));
      await flush();
      expect(invoked).toContainEqual({ cmd: "open_news_link", args: { url: "https://a.example/story" } });
    } finally {
      vi.useRealTimers();
    }
  });
});
