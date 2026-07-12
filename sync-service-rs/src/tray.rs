use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use image::{ImageBuffer, Rgba};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};

use crate::sync_job::AppState;

static EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

pub fn exit_requested() -> bool {
    EXIT_REQUESTED.load(Ordering::SeqCst)
}

pub fn request_exit() {
    EXIT_REQUESTED.store(true, Ordering::SeqCst);
}

fn create_icon_rgba() -> (Vec<u8>, u32, u32) {
    let size = 64u32;
    let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_pixel(size, size, Rgba([0, 0, 0, 0]));
    for y in 10..54 {
        for x in 10..54 {
            let in_rounded = {
                let cx = if x < 22 { 22i32 - x as i32 } else if x > 42 { x as i32 - 42 } else { 0 };
                let cy = if y < 22 { 22i32 - y as i32 } else if y > 42 { y as i32 - 42 } else { 0 };
                (cx * cx + cy * cy) <= 12 * 12 || (x >= 22 && x <= 42) || (y >= 22 && y <= 42)
            };
            if !in_rounded {
                continue;
            }
            if (18..26).contains(&y) {
                img.put_pixel(x, y, Rgba([58, 88, 142, 255]));
            } else {
                img.put_pixel(x, y, Rgba([16, 19, 24, 255]));
            }
        }
    }
    for y in 34..44 {
        for x in 20..30 {
            let dx = x as i32 - 25;
            let dy = y as i32 - 39;
            if dx * dx + dy * dy <= 25 {
                img.put_pixel(x, y, Rgba([57, 211, 83, 255]));
            }
        }
        for x in 34..44 {
            let dx = x as i32 - 39;
            let dy = y as i32 - 39;
            if dx * dx + dy * dy <= 25 {
                img.put_pixel(x, y, Rgba([255, 255, 255, 220]));
            }
        }
    }
    (img.into_raw(), size, size)
}

pub fn run_tray(state: Arc<AppState>) -> anyhow::Result<()> {
    let version = env!("CARGO_PKG_VERSION");
    let menu = Menu::new();
    let version_item = MenuItem::new(version, false, None);
    let restart_item = MenuItem::new("Restart", true, None);
    let open_dir_item = MenuItem::new("Open Directory", true, None);
    let exit_item = MenuItem::new("Exit", true, None);
    menu.append(&version_item)?;
    menu.append(&PredefinedMenuItem::separator())?;
    menu.append(&restart_item)?;
    menu.append(&open_dir_item)?;
    menu.append(&exit_item)?;

    let (rgba, w, h) = create_icon_rgba();
    let icon = Icon::from_rgba(rgba, w, h)?;

    let _tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Ultimately Wallpaper")
        .with_icon(icon)
        .build()?;

    tracing::info!("Tray icon initialized");

    let menu_channel = MenuEvent::receiver();
    let base_dir = state.config.read().base_dir.clone();

    loop {
        #[cfg(windows)]
        pump_windows_messages();

        if let Ok(event) = menu_channel.try_recv() {
            if event.id == restart_item.id() {
                relaunch(&base_dir)?;
                request_exit();
                state.shutdown.notify_waiters();
                break;
            } else if event.id == open_dir_item.id() {
                let _ = open::that(&base_dir);
            } else if event.id == exit_item.id() {
                request_exit();
                state.shutdown.notify_waiters();
                break;
            }
        }

        if exit_requested() {
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(16));
    }

    Ok(())
}

#[cfg(windows)]
fn pump_windows_messages() {
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };
    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn relaunch(base_dir: &PathBuf) -> anyhow::Result<()> {
    let exe = std::env::current_exe()?;
    let mut command = Command::new(exe);
    command.current_dir(base_dir);
    crate::process_win::hide_console(&mut command);
    command.spawn()?;
    Ok(())
}
