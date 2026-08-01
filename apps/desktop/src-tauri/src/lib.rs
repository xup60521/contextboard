mod auth;
mod bridge;
mod commands;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(auth::AuthHandoffState::default())
        .manage(bridge::BridgeState::default())
        .setup(|app| {
            let root = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Unable to resolve desktop app data: {error}"))?;
            let storage = storage::Storage::open(root)
                .map_err(|error| format!("Unable to initialize desktop storage: {error:?}"))?;
            let enabled = bridge::is_enabled(&storage).unwrap_or(false);
            let port = bridge::configured_port(&storage).unwrap_or(bridge::DEFAULT_PORT);
            app.manage(storage);
            // Only resumes a bridge the user previously switched on. A failure
            // to bind must not stop the app from starting; the settings panel
            // reports the bridge as off and the user can retry on another port.
            if enabled {
                if let Err(error) = app
                    .state::<bridge::BridgeState>()
                    .start(port, app.handle().clone())
                {
                    eprintln!("Agent bridge did not start: {}", error.message);
                }
            }
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
            commands::workspace_device_id,
            commands::workspace_has_data,
            commands::workspace_adopt,
            commands::desktop_setting,
            commands::desktop_set_setting,
            commands::desktop_bridge_status,
            commands::desktop_bridge_set_enabled,
            commands::desktop_auth_start,
            commands::desktop_auth_wait,
            commands::desktop_auth_cancel,
            commands::desktop_auth_store_token,
            commands::desktop_auth_token,
            commands::desktop_auth_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Contextboard");
}
