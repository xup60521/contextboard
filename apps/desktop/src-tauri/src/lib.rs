mod commands;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Unable to resolve desktop app data: {error}"))?;
            let storage = storage::Storage::open(root)
                .map_err(|error| format!("Unable to initialize desktop storage: {error:?}"))?;
            app.manage(storage);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::desktop_bootstrap,
            commands::workspace_query,
            commands::workspace_execute,
            commands::workspace_pending_batches,
            commands::workspace_acknowledge,
            commands::workspace_apply_remote,
            commands::workspace_sync_state,
            commands::workspace_read_blob,
            commands::workspace_missing_blobs,
            commands::workspace_store_blob,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Contextboard");
}
