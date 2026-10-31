mod alarm;
mod command;
mod db;
mod error;
mod focus;
mod model;
#[cfg(target_os = "linux")]
mod pinch;
mod settings;
mod tasks;

pub use error::{AppError, Result};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let conn = db::open(&dir)?;
            // Closes a session that ran out while the app was closed, and arms
            // the alarm for one that is still running.
            let open = focus::current(&conn, chrono::Utc::now())?;
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            let alarm = alarm::spawn(app.handle().clone())?;
            alarm.follow(open.as_ref());
            app.manage(alarm);
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                pinch::install(&window)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            command::list_tasks,
            command::create_task,
            command::update_task,
            command::toggle_task,
            command::delete_task,
            command::set_task_tags,
            command::set_task_deps,
            command::add_block,
            command::update_block,
            command::delete_block,
            command::current_focus,
            command::start_focus,
            command::pause_focus,
            command::resume_focus,
            command::finish_focus,
            command::log_interruption,
            command::focus_day,
            command::get_settings,
            command::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running tauri application")
}
