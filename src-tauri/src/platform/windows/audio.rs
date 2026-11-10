//! How loud the speakers are right now, from Core Audio's peak meter.
//! Public API, no permission.

use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eConsole, eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// Peaks at or below this are silence (0 to 1 scale).
pub const SILENCE: f32 = 0.001;

/// The default output's volume control, the one the taskbar's slider moves.
pub fn endpoint_volume() -> Option<IAudioEndpointVolume> {
    // SAFETY: COM calls on interfaces the calls return; initializing COM again
    // on the same thread is allowed and harmless.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let devices: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let speaker = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        speaker.Activate(CLSCTX_ALL, None).ok()
    }
}

/// The default output's current peak level, from 0 to 1.
pub fn output_peak() -> Option<f32> {
    // SAFETY: COM calls on interfaces the calls return; initializing COM again
    // on the same thread is allowed and harmless.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let devices: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let speaker = devices.GetDefaultAudioEndpoint(eRender, eMultimedia).ok()?;
        let meter: IAudioMeterInformation = speaker.Activate(CLSCTX_ALL, None).ok()?;
        meter.GetPeakValue().ok()
    }
}
