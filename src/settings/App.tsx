import { Bell, Code, Globe, Info, LayoutGrid, Moon, Music2, Settings2, Sparkles, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
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
import { resolveLanguage, setLanguage, t, tSplit, useLanguage } from "../shared/i18n";
import { useSnapshot } from "./useSnapshot";

const TABS = [
  { id: "general", label: "nav.general", icon: Settings2, description: "nav.generalDesc" },
  { id: "notifications", label: "nav.notifications", icon: Bell, description: "nav.notificationsDesc" },
  { id: "music", label: "nav.music", icon: Music2, description: "nav.musicDesc" },
  { id: "widgets", label: "nav.widgets", icon: LayoutGrid, description: "nav.widgetsDesc" },
  { id: "browser", label: "nav.browser", icon: Globe, description: "nav.browserDesc" },
  { id: "api", label: "nav.api", icon: Code, description: "nav.apiDesc" },
  { id: "about", label: "nav.about", icon: Info, description: "nav.aboutDesc" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** The island in miniature, used as the app mark. */
function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-b from-neutral-700 to-black shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_2px_6px_rgb(0_0_0/0.25)] ring-1 ring-black/20"
    >
      <span className="flex h-2.5 w-5 items-center rounded-full bg-black pl-0.5 ring-1 ring-white/15">
        <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgb(52_211_153/0.9)]" />
      </span>
    </span>
  );
}

export function App() {
  const api = useSnapshot();
  const { snap, error, setError, run } = api;
  const [tab, setTab] = useState<TabId>("general");
  // macOS opens Settings with a transparent window and native sidebar glass.
  const vibrant = snap?.platform === "macos";
  useEffect(() => {
    document.documentElement.classList.toggle("vibrant", vibrant);
  }, [vibrant]);
  // Redraws everything when the language changes.
  useLanguage();
  const language = snap?.settings.language;
  useEffect(() => setLanguage(resolveLanguage(language)), [language]);

  if (!snap) {
    return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const { settings } = snap;
  const shortcut = formatAccelerator(settings.toggleShortcut, snap.platform === "macos");
  const openHint = tSplit(settings.expandTrigger === "hover" ? "welcome.openHover" : "welcome.openClick", "shortcut");
  const current = TABS.find((item) => item.id === tab)!;

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "flex w-14 shrink-0 flex-col border-r border-black/[0.06] p-2 sm:w-56 sm:p-3 dark:border-white/[0.06]",
          vibrant ? "bg-transparent pt-10" : "bg-sidebar",
        )}
        data-tauri-drag-region={vibrant || undefined}
      >
        <div className="mb-5 flex items-center gap-2.5 px-1 py-1 sm:px-2" data-tauri-drag-region={vibrant || undefined}>
          <BrandMark />
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-semibold">Lintel</div>
            <div className="text-xs text-muted-foreground">v{snap.version}</div>
          </div>
        </div>
        <nav aria-label={t("nav.sections")} className="flex flex-col gap-0.5">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                aria-label={t(item.label)}
                onClick={() => setTab(item.id)}
                className={cn(
                  "relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "font-medium text-foreground" : "text-foreground/65 hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg bg-black/[0.07] dark:bg-white/[0.09]"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <item.icon className={cn("relative size-4 shrink-0", active ? "text-foreground" : "text-foreground/50")} strokeWidth={1.75} aria-hidden="true" />
                <span className="relative hidden sm:inline">{t(item.label)}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center justify-center gap-2 rounded-md px-1 py-2 sm:justify-between sm:px-2.5">
          <label htmlFor="sidebar-dnd" className="hidden items-center gap-2 text-[13px] text-foreground/65 sm:flex">
            <Moon className="size-4" aria-hidden="true" />
            {t("common.doNotDisturb")}
          </label>
          <Switch
            id="sidebar-dnd"
            aria-label={t("common.doNotDisturb")}
            checked={settings.doNotDisturb}
            onCheckedChange={(v) => run(() => setDoNotDisturb(v))}
          />
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto bg-canvas">
        {/* The overlay title bar has no strip of its own; this one drags the window. */}
        {vibrant && <div className="absolute inset-x-0 top-0 h-8" data-tauri-drag-region />}
        <div className="mx-auto max-w-2xl space-y-7 px-6 py-9 sm:px-10">
          <header className="space-y-1 px-1">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{t(current.label)}</h1>
            <p className="text-[13px] text-muted-foreground">{t(current.description)}</p>
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
                    {t("welcome.title")}
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>{t(snap.layout.notch ? "welcome.positionNotch" : "welcome.position")}</li>
                    <li>
                      {openHint[0]}
                      <Kbd>{shortcut}</Kbd>
                      {openHint[1]}
                    </li>
                    <li>{t("welcome.alerts")}</li>
                    <li>{t("welcome.api")}</li>
                  </ul>
                  <Button size="sm" onClick={() => run(completeOnboarding)}>
                    {t("welcome.done")}
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
    <Button variant="ghost" size="icon-sm" className="absolute top-1.5 right-1.5 size-7" aria-label={t("common.dismiss")} onClick={onClick}>
      <X aria-hidden="true" />
    </Button>
  );
}
