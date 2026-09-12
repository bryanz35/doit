mod command;
mod db;
mod error;
mod model;
mod tasks;

pub use error::{AppError, Result};

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let conn = db::open(&dir)?;
            app.manage(db::Db(std::sync::Mutex::new(conn)));
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
        ])
        .run(tauri::generate_context!())
        .expect("Error while running tauri application")
}
