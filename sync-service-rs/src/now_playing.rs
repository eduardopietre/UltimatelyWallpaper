use serde_json::{json, Value};

pub fn get_now_playing() -> Value {
    #[cfg(windows)]
    {
        match windows_now_playing() {
            Ok(value) => value,
            Err(_) => json!({ "available": false }),
        }
    }
    #[cfg(not(windows))]
    {
        json!({ "available": false })
    }
}

pub fn media_control(action: &str) -> bool {
    #[cfg(windows)]
    {
        windows_media_control(action).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        false
    }
}

#[cfg(windows)]
fn windows_now_playing() -> anyhow::Result<Value> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = manager.GetCurrentSession()?;
    // GetCurrentSession returns null session as error in some bindings — check via Result
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let playback = session.GetPlaybackInfo()?;
    let status = playback.PlaybackStatus()?.0;
    let timeline = session.GetTimelineProperties()?;

    let start = timeline.StartTime()?.Duration as f64 / 10_000_000.0;
    let end = timeline.EndTime()?.Duration as f64 / 10_000_000.0;
    let position_raw = timeline.Position()?.Duration as f64 / 10_000_000.0;
    let position = (position_raw - start).max(0.0);
    let duration = if end > start { Some(end - start) } else { None };

    let status_name = match status {
        0 => "closed",
        1 => "opened",
        2 => "changing",
        3 => "stopped",
        4 => "playing",
        5 => "paused",
        _ => "unknown",
    };

    let thumbnail = read_thumbnail(&props).ok().flatten();

    Ok(json!({
        "available": true,
        "title": props.Title().map(|s| s.to_string()).unwrap_or_default(),
        "artist": props.Artist().map(|s| s.to_string()).unwrap_or_default(),
        "album": props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
        "status": status_name,
        "playing": status == 4,
        "position": position,
        "duration": duration,
        "appId": session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default(),
        "thumbnail": thumbnail,
    }))
}

#[cfg(windows)]
fn read_thumbnail(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> anyhow::Result<Option<String>> {
    use base64::Engine;
    use windows::Storage::Streams::DataReader;

    let reference = props.Thumbnail()?;
    let stream = reference.OpenReadAsync()?.get()?;
    let size = stream.Size()?;
    if size == 0 || size > 4_000_000 {
        return Ok(None);
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size as u32)?.get()?;
    let mut buffer = vec![0u8; size as usize];
    reader.ReadBytes(&mut buffer)?;
    let content_type = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_else(|_| "image/png".into());
    let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
    Ok(Some(format!("data:{content_type};base64,{encoded}")))
}

#[cfg(windows)]
fn windows_media_control(action: &str) -> anyhow::Result<bool> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    let session = manager.GetCurrentSession()?;
    let ok = match action {
        "play_pause" => session.TryTogglePlayPauseAsync()?.get()?,
        "next" => session.TrySkipNextAsync()?.get()?,
        "previous" => session.TrySkipPreviousAsync()?.get()?,
        _ => false,
    };
    Ok(ok)
}
