//! The track any app is playing, from Windows' media sessions (the same data
//! as the volume flyout): Spotify, Media Player, browsers and others.
//! Public API, no permission.

use std::sync::Mutex;

use base64::Engine;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::core::media::{app_from_aumid, track, MediaCommand, NowPlaying};
use crate::errors::{AppError, AppResult};

/// Covers bigger than this are left out; session thumbnails are usually 300 px.
const ART_MAX: u32 = 300 * 1024;

/// The last track (`app\ntitle\nartist`) and its cover, so each reads once.
static ART: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

fn manager() -> Option<Manager> {
    // SAFETY: initializing COM again on the same thread is allowed and harmless.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    Manager::RequestAsync().ok()?.join().ok()
}

fn playing(session: &Session) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .is_ok_and(|s| s == Status::Playing)
}

fn app_of(session: &Session) -> String {
    app_from_aumid(&session.SourceAppUserModelId().map(|a| a.to_string_lossy()).unwrap_or_default())
}

/// The first session that is playing, else none.
pub fn now_playing() -> Option<NowPlaying> {
    let session = manager()?.GetSessions().ok()?.into_iter().find(playing)?;
    let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let mut np = track(
        &app_of(&session),
        &props.Title().ok()?.to_string_lossy(),
        &props.Artist().map(|a| a.to_string_lossy()).unwrap_or_default(),
    )?;
    np.image = artwork(&format!("{}\n{}\n{}", np.app, np.title, np.artist), &props);
    Some(np)
}

fn artwork(key: &str, props: &Properties) -> Option<String> {
    let mut cache = ART.lock().ok()?;
    if let Some((cached, image)) = cache.as_ref() {
        if cached == key {
            return image.clone();
        }
    }
    let image = thumbnail(props);
    *cache = Some((key.to_string(), image.clone()));
    image
}

/// The cover as a data URL; the page may only show `data:` images.
fn thumbnail(props: &Properties) -> Option<String> {
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok().filter(|s| (1..=ART_MAX).contains(s))?;
    let kind = stream.ContentType().map(|k| k.to_string_lossy()).unwrap_or_default();
    let kind = if kind.starts_with("image/") { kind } else { "image/png".into() };
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{kind};base64,{b64}"))
}

/// Sends the command to `player`'s session, else to the current one (a
/// website's report names the site, not the browser).
pub fn control(player: &str, command: MediaCommand) -> AppResult<()> {
    let fail = || AppError::Platform("no media session to control".into());
    let manager = manager().ok_or_else(fail)?;
    let session = manager
        .GetSessions()
        .ok()
        .and_then(|all| all.into_iter().find(|s| app_of(s) == player))
        .or_else(|| manager.GetCurrentSession().ok())
        .ok_or_else(fail)?;
    let op = match command {
        MediaCommand::PlayPause => session.TryTogglePlayPauseAsync(),
        MediaCommand::Next => session.TrySkipNextAsync(),
        MediaCommand::Previous => session.TrySkipPreviousAsync(),
    };
    let done = op.and_then(|o| o.join()).map_err(|e| AppError::Platform(e.to_string()))?;
    if done {
        Ok(())
    } else {
        Err(AppError::Platform(format!("{player} ignored the request")))
    }
}
