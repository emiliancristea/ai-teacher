// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod process_monitor;
mod screen_capture;

use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(screen_capture::ScreenCaptureState::default())
        .invoke_handler(tauri::generate_handler![
            commands::capture_screen,
            commands::get_active_window,
            commands::get_system_context,
            commands::list_windows_by_process,
            commands::capture_window,
            commands::capture_window_with_ocr,
            commands::extract_text_from_image,
            commands::start_monitoring,
            commands::stop_monitoring,
            commands::get_capture_interval,
            commands::set_capture_interval,
            commands::minimize_window,
            commands::maximize_window,
            commands::close_window,
            commands::execute_command,
        ])
        .setup(|app| {
            // Show and focus the main window
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap_or_default();
                window.set_focus().unwrap_or_default();
            }
            
            // Emit initial ready event
            app.emit("app-ready", ()).unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

