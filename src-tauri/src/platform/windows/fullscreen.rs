//! Whether a full-screen app, game or presentation is running, the same
//! check Windows uses to hold back its own notifications.

use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};

pub fn active() -> bool {
    // SAFETY: takes no arguments and only returns a state.
    unsafe { SHQueryUserNotificationState() }.is_ok_and(|s| {
        [
            QUNS_BUSY,
            QUNS_RUNNING_D3D_FULL_SCREEN,
            QUNS_PRESENTATION_MODE,
        ]
        .contains(&s)
    })
}
