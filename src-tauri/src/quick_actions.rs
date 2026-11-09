//! One-tap system actions for the Quick actions widget. Each action is a
//! fixed operation per platform; the page only names which one to run.

use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::actions;
use crate::errors::{AppError, AppResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum QuickAction {
    /// Keeps the display and the computer from sleeping until turned off.
    KeepAwake,
    /// The system screenshot tool.
    Screenshot,
    /// Mutes or unmutes the sound output.
    Mute,
    /// Locks the screen (on macOS, sleeps the display, which locks it when a
    /// password is required after sleep).
    Lock,
    Calculator,
    /// The Downloads folder.
    Downloads,
    /// Starts or stops a screen recording (on Windows, opens Snipping Tool,
    /// which records from its toolbar).
    Record,
}

/// Runs an action. Toggles return their new state when it is known.
pub fn run(app: &AppHandle, action: QuickAction) -> AppResult<Option<bool>> {
    log::info!("quick action {action:?}");
    match action {
        QuickAction::KeepAwake => {
            let st = actions::state(app);
            let on = {
                let mut keep = st.keep_awake.lock().unwrap_or_else(|e| e.into_inner());
                let on = !keep.is_on();
                keep.set(on)?;
                on
            };
            actions::notify_ui(app);
            Ok(Some(on))
        }
        QuickAction::Downloads => {
            let dir = app
                .path()
                .download_dir()
                .map_err(|e| AppError::Platform(e.to_string()))?;
            actions::open_with_system(&dir)?;
            Ok(None)
        }
        QuickAction::Mute => toggle_mute(),
        QuickAction::Screenshot => launch(platform::SCREENSHOT),
        QuickAction::Lock => platform::lock().map(|_| None),
        QuickAction::Calculator => launch(platform::CALCULATOR),
        QuickAction::Record => record(app),
    }
}

/// Starts a recording of the main display to the Desktop, or stops the
/// running one, shows the file in Finder and says where it went.
#[cfg(target_os = "macos")]
fn record(app: &AppHandle) -> AppResult<Option<bool>> {
    use crate::core::notifications::{NotificationInput, NotificationSource, Symbol};

    let st = actions::state(app);
    let mut recorder = st.recorder.lock().unwrap_or_else(|e| e.into_inner());
    if recorder.since().is_none() {
        let dir = app
            .path()
            .desktop_dir()
            .map_err(|e| AppError::Platform(e.to_string()))?;
        recorder.start(&dir)?;
        drop(recorder);
        actions::notify_ui(app);
        return Ok(Some(true));
    }
    // Writing the movie can take seconds; wait without holding the lock,
    // which every state snapshot needs.
    let recording = recorder.take();
    drop(recorder);
    actions::notify_ui(app);
    if let Some(path) = recording.map(|r| r.finish()).transpose()?.flatten() {
        let _ = Command::new("open").arg("-R").arg(&path).spawn();
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
        let _ = actions::push_notification(
            app,
            NotificationInput {
                title: "Screen recording saved".into(),
                body: name.map(|n| format!("Desktop · {n}")),
                app: Some("Islet".into()),
                icon: None,
                accent: Some("#dc2626".into()),
                image: None,
            },
            Some(Symbol::Recording),
            NotificationSource::System,
        );
    }
    Ok(Some(false))
}

#[cfg(not(target_os = "macos"))]
fn record(_app: &AppHandle) -> AppResult<Option<bool>> {
    launch(platform::RECORDER)
}

fn launch(command: &[&str]) -> AppResult<Option<bool>> {
    let (program, args) = command
        .split_first()
        .ok_or_else(|| AppError::Platform("not available on this OS".into()))?;
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| None)
        .map_err(|e| AppError::Platform(format!("could not start {program}: {e}")))
}

#[cfg(target_os = "macos")]
fn toggle_mute() -> AppResult<Option<bool>> {
    let out = Command::new("osascript")
        .args([
            "-e",
            "set m to not (output muted of (get volume settings))",
            "-e",
            "set volume output muted m",
            "-e",
            "return m",
        ])
        .output()?;
    match String::from_utf8_lossy(&out.stdout).trim() {
        "true" => Ok(Some(true)),
        "false" => Ok(Some(false)),
        // Some outputs, such as HDMI displays, cannot be muted.
        _ => Err(AppError::Platform(
            "this sound output cannot be muted".into(),
        )),
    }
}

#[cfg(target_os = "windows")]
fn toggle_mute() -> AppResult<Option<bool>> {
    platform::press_mute_key();
    // The mute key toggles without saying which way.
    Ok(None)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn toggle_mute() -> AppResult<Option<bool>> {
    Err(AppError::Platform("not available on this OS".into()))
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command};
    use std::thread;
    use std::time::Duration;

    use crate::core::notifications::now_ms;
    use crate::errors::{AppError, AppResult};

    pub const SCREENSHOT: &[&str] = &["open", "/System/Applications/Utilities/Screenshot.app"];
    pub const CALCULATOR: &[&str] = &["open", "/System/Applications/Calculator.app"];

    pub fn lock() -> AppResult<()> {
        Command::new("pmset").arg("displaysleepnow").spawn()?;
        Ok(())
    }

    pub struct Recording {
        child: Child,
        path: PathBuf,
        started_ms: u64,
    }

    /// A `screencapture -v` process. It records until it gets SIGINT, then
    /// finishes writing the movie and exits.
    #[derive(Default)]
    pub struct Recorder {
        active: Option<Recording>,
    }

    impl Recorder {
        /// When the running recording started, in Unix milliseconds.
        pub fn since(&mut self) -> Option<u64> {
            let rec = self.active.as_mut()?;
            if matches!(rec.child.try_wait(), Ok(None)) {
                return Some(rec.started_ms);
            }
            self.active = None;
            None
        }

        pub fn start(&mut self, dir: &Path) -> AppResult<()> {
            let name = chrono::Local::now()
                .format("Screen Recording %Y-%m-%d at %H.%M.%S.mov")
                .to_string();
            let path = dir.join(name);
            let mut child = Command::new("screencapture")
                .args(["-v", "-C", "-k", "-x"])
                .arg(&path)
                .spawn()?;
            // Without permission it gives up at once.
            thread::sleep(Duration::from_millis(400));
            if child.try_wait()?.is_some() {
                return Err(AppError::Platform(
                    "Allow Islet in System Settings → Privacy & Security → Screen Recording".into(),
                ));
            }
            self.active = Some(Recording {
                child,
                path,
                started_ms: now_ms(),
            });
            Ok(())
        }

        /// Hands over the running recording, to be finished without the
        /// recorder borrowed.
        pub fn take(&mut self) -> Option<Recording> {
            self.active.take()
        }

        /// Stops and returns the movie, once it is written.
        pub fn stop(&mut self) -> AppResult<Option<PathBuf>> {
            self.take()
                .map(Recording::finish)
                .transpose()
                .map(Option::flatten)
        }
    }

    impl Recording {
        /// Stops recording and waits until the movie is written.
        pub fn finish(mut self) -> AppResult<Option<PathBuf>> {
            Command::new("kill")
                .args(["-INT", &self.child.id().to_string()])
                .status()?;
            for _ in 0..100 {
                if self.child.try_wait()?.is_some() {
                    return Ok(self.path.exists().then_some(self.path));
                }
                thread::sleep(Duration::from_millis(50));
            }
            let _ = self.child.kill();
            Err(AppError::Platform("the recording did not finish".into()))
        }
    }

    /// Runs `caffeinate` while on. It also exits on its own when Islet does.
    #[derive(Default)]
    pub struct KeepAwake {
        child: Option<Child>,
    }

    impl KeepAwake {
        pub fn is_on(&mut self) -> bool {
            if let Some(child) = &mut self.child {
                if matches!(child.try_wait(), Ok(None)) {
                    return true;
                }
                self.child = None;
            }
            false
        }

        pub fn set(&mut self, on: bool) -> AppResult<()> {
            if let Some(mut child) = self.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            if on {
                let pid = std::process::id().to_string();
                self.child = Some(
                    Command::new("caffeinate")
                        .args(["-d", "-i", "-w", &pid])
                        .spawn()?,
                );
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::sync::mpsc::{channel, Sender};
    use std::thread;

    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    use windows::Win32::System::Shutdown::LockWorkStation;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_KEYUP, VK_VOLUME_MUTE,
    };

    use crate::errors::{AppError, AppResult};

    pub const SCREENSHOT: &[&str] = &["explorer", "ms-screenclip:"];
    pub const CALCULATOR: &[&str] = &["calc"];
    pub const RECORDER: &[&str] = &["explorer", "ms-screenclip:"];

    pub fn lock() -> AppResult<()> {
        unsafe { LockWorkStation() }.map_err(|e| AppError::Platform(e.to_string()))
    }

    pub fn press_mute_key() {
        let key = VK_VOLUME_MUTE.0 as u8;
        unsafe {
            keybd_event(key, 0, Default::default(), 0);
            keybd_event(key, 0, KEYEVENTF_KEYUP, 0);
        }
    }

    /// The execution state belongs to a thread, so a thread holds it while on.
    #[derive(Default)]
    pub struct KeepAwake {
        stop: Option<Sender<()>>,
    }

    impl KeepAwake {
        pub fn is_on(&mut self) -> bool {
            self.stop.is_some()
        }

        pub fn set(&mut self, on: bool) -> AppResult<()> {
            // Dropping the sender ends the thread, which clears the state.
            self.stop = None;
            if on {
                let (tx, rx) = channel::<()>();
                thread::Builder::new()
                    .name("islet-keep-awake".into())
                    .spawn(move || {
                        unsafe {
                            SetThreadExecutionState(
                                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED,
                            );
                        }
                        let _ = rx.recv();
                        unsafe {
                            SetThreadExecutionState(ES_CONTINUOUS);
                        }
                    })?;
                self.stop = Some(tx);
            }
            Ok(())
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use crate::errors::{AppError, AppResult};

    pub const SCREENSHOT: &[&str] = &[];
    pub const CALCULATOR: &[&str] = &[];
    pub const RECORDER: &[&str] = &[];

    pub fn lock() -> AppResult<()> {
        Err(AppError::Platform("not available on this OS".into()))
    }

    #[derive(Default)]
    pub struct KeepAwake;

    impl KeepAwake {
        pub fn is_on(&mut self) -> bool {
            false
        }

        pub fn set(&mut self, on: bool) -> AppResult<()> {
            if on {
                return Err(AppError::Platform("not available on this OS".into()));
            }
            Ok(())
        }
    }
}

pub use platform::KeepAwake;
#[cfg(target_os = "macos")]
pub use platform::Recorder;

/// Recording happens in another app off macOS, so there is never one here.
#[cfg(not(target_os = "macos"))]
#[derive(Default)]
pub struct Recorder {}

#[cfg(not(target_os = "macos"))]
impl Recorder {
    pub fn since(&mut self) -> Option<u64> {
        None
    }

    pub fn stop(&mut self) -> AppResult<Option<std::path::PathBuf>> {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actions_parse_in_kebab_case() {
        let a: QuickAction = serde_json::from_str(r#""keep-awake""#).unwrap();
        assert_eq!(a, QuickAction::KeepAwake);
        assert!(serde_json::from_str::<QuickAction>(r#""rm -rf""#).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keep_awake_starts_and_stops_caffeinate() {
        let mut k = KeepAwake::default();
        assert!(!k.is_on());
        k.set(true).unwrap();
        assert!(k.is_on());
        k.set(false).unwrap();
        assert!(!k.is_on());
    }
}
