import { Bell, Code, Globe, Info, LayoutGrid, Moon, Music2, Settings2, Sparkles, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { formatAccelerator } from "@/features/shortcuts/accelerator";
import { cn } from "@/lib/utils";
import { completeOnboarding, dismissError, setDoNotDisturb } from "../shared/commands";
import {
  AboutSection,
  ApiSection,
  BrowserSection,
  GeneralSection,
  NotificationsSection,
  NowPlayingSection,
  WidgetsSection,
} from "./sections";
import { useSnapshot } from "./useSnapshot";

const TABS = [
  { id: "general", label: "General", icon: Settings2, description: "Style, shortcut and startup." },
  { id: "notifications", label: "Notifications", icon: Bell, description: "How notifications reach the island." },
  { id: "music", label: "Now playing", icon: Music2, description: "Music bars and titles." },
  { id: "widgets", label: "Widgets", icon: LayoutGrid, description: "What the open island shows." },
  { id: "browser", label: "Browser", icon: Globe, description: "Notifications from websites." },
  { id: "api", label: "API", icon: Code, description: "Send notifications from scripts and tools." },
  { id: "about", label: "About", icon: Info, description: "Version and reset." },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** The island in miniature, used as the app mark. */
function BrandMark() {
  return (
    <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-primary">
      <span className="flex h-2.5 w-5 items-center rounded-full bg-primary-foreground/90 pl-0.5 dark:bg-black">
        <span className="size-1.5 rounded-full bg-success" />
      </span>
    </span>
  );
}

export function App() {
  const api = useSnapshot();
  const { snap, error, setError, run } = api;
  const [tab, setTab] = useState<TabId>("general");

  if (!snap) {
    return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  const { settings } = snap;
  const shortcut = formatAccelerator(settings.toggleShortcut, snap.platform === "macos");
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-14 shrink-0 flex-col border-r bg-sidebar p-2 sm:w-56 sm:p-3">
        <div className="mb-4 flex items-center gap-2.5 px-1 py-1 sm:px-2">
          <BrandMark />
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-semibold">Islet</div>
            <div className="text-xs text-muted-foreground">v{snap.version}</div>
          </div>
        </div>
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-current={active ? "page" : undefined}
                aria-label={t.label}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-md bg-accent"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <t.icon className="relative size-4 shrink-0" aria-hidden="true" />
                <span className="relative hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center justify-center gap-2 rounded-md px-1 py-2 sm:justify-between sm:px-2.5">
          <label htmlFor="sidebar-dnd" className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <Moon className="size-4" aria-hidden="true" />
            Do Not Disturb
          </label>
          <Switch
            id="sidebar-dnd"
            aria-label="Do Not Disturb"
            checked={settings.doNotDisturb}
            onCheckedChange={(v) => run(() => setDoNotDisturb(v))}
          />
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-8 sm:px-10">
          <header className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{current.label}</h1>
            <p className="text-sm text-muted-foreground">{current.description}</p>
          </header>

          <AnimatePresence initial={false}>
            {!settings.onboardingCompleted && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
              >
                <Card className="space-y-3 p-5">
                  <div className="flex items-center gap-2 font-medium">
                    <Sparkles className="size-4" aria-hidden="true" />
                    Welcome to Islet
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>The island sits at the top center of your screen{snap.layout.notch ? ", around the notch" : ""}.</li>
                    <li>
                      {settings.expandTrigger === "hover" ? "Hover over it" : "Click it"} or press <Kbd>{shortcut}</Kbd> to open
                      widgets and notifications.
                    </li>
                    <li>New notifications pop out for a few seconds. Timers and unread counts show beside it.</li>
                    <li>Scripts can send notifications through the local API.</li>
                  </ul>
                  <Button size="sm" onClick={() => run(completeOnboarding)}>
                    Got it
                  </Button>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {(error || snap.lastError || snap.warnings.length > 0) && (
            <div className="space-y-2">
              {error && (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden="true" />
                  <AlertDescription>{error}</AlertDescription>
                  <DismissButton onClick={() => setError(null)} />
                </Alert>
              )}
              {snap.lastError && !error && (
                <Alert>
                  <TriangleAlert aria-hidden="true" />
                  <AlertDescription>{snap.lastError}</AlertDescription>
                  <DismissButton onClick={() => run(dismissError)} />
                </Alert>
              )}
              {snap.warnings.map((w) => (
                <Alert key={w}>
                  <Info aria-hidden="true" />
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {tab === "general" && <GeneralSection snap={snap} api={api} />}
              {tab === "notifications" && <NotificationsSection snap={snap} api={api} />}
              {tab === "music" && <NowPlayingSection snap={snap} api={api} />}
              {tab === "widgets" && <WidgetsSection snap={snap} api={api} />}
              {tab === "browser" && <BrowserSection snap={snap} api={api} />}
              {tab === "api" && <ApiSection snap={snap} api={api} />}
              {tab === "about" && <AboutSection snap={snap} api={api} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5 size-7" aria-label="Dismiss" onClick={onClick}>
      <X aria-hidden="true" />
    </Button>
  );
}
