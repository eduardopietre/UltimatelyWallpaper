"""Now-playing info from the Windows System Media Transport Controls (SMTC).

Uses the winsdk projection of ``Windows.Media.Control`` to read whatever media
session is currently active (Spotify, browsers, groove, etc.) and to send
transport commands. Every public function degrades gracefully: on any failure
(non-Windows host, no winsdk, no active session) it returns
``{"available": False}`` instead of raising, so the gadget can simply hide.
"""

from __future__ import annotations

import asyncio
import base64

_MEDIA_STATUS = {
    0: "closed",
    1: "opened",
    2: "changing",
    3: "stopped",
    4: "playing",
    5: "paused",
}


def _seconds(value) -> float | None:
    try:
        return value.total_seconds()
    except Exception:
        return None


async def _read_thumbnail(props) -> str | None:
    reference = getattr(props, "thumbnail", None)
    if reference is None:
        return None
    try:
        from winsdk.windows.storage.streams import DataReader

        stream = await reference.open_read_async()
        size = stream.size
        if not size or size > 4_000_000:
            return None
        reader = DataReader(stream.get_input_stream_at(0))
        await reader.load_async(size)
        buffer = bytearray(size)
        reader.read_bytes(buffer)
        content_type = stream.content_type or "image/png"
        encoded = base64.b64encode(bytes(buffer)).decode("ascii")
        return f"data:{content_type};base64,{encoded}"
    except Exception:
        return None


async def _get_now_playing_async() -> dict:
    from winsdk.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    )

    manager = await MediaManager.request_async()
    session = manager.get_current_session()
    if session is None:
        return {"available": False}

    props = await session.try_get_media_properties_async()
    playback = session.get_playback_info()
    status = int(playback.playback_status)
    timeline = session.get_timeline_properties()

    start = _seconds(timeline.start_time) or 0.0
    end = _seconds(timeline.end_time) or 0.0
    position = (_seconds(timeline.position) or 0.0) - start
    duration = (end - start) if end > start else None

    return {
        "available": True,
        "title": props.title or "",
        "artist": props.artist or "",
        "album": props.album_title or "",
        "status": _MEDIA_STATUS.get(status, "unknown"),
        "playing": status == 4,
        "position": max(0.0, position),
        "duration": duration,
        "appId": session.source_app_user_model_id or "",
        "thumbnail": await _read_thumbnail(props),
    }


async def _control_async(action: str) -> bool:
    from winsdk.windows.media.control import (
        GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    )

    manager = await MediaManager.request_async()
    session = manager.get_current_session()
    if session is None:
        return False

    if action == "play_pause":
        return bool(await session.try_toggle_play_pause_async())
    if action == "next":
        return bool(await session.try_skip_next_async())
    if action == "previous":
        return bool(await session.try_skip_previous_async())
    return False


def get_now_playing() -> dict:
    try:
        return asyncio.run(_get_now_playing_async())
    except Exception:
        return {"available": False}


def media_control(action: str) -> bool:
    try:
        return asyncio.run(_control_async(action))
    except Exception:
        return False
