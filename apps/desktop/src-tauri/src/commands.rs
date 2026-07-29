use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBootstrap {
    pub version: &'static str,
    pub platform: &'static str,
    pub storage_available: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CommandError {
    pub code: &'static str,
    pub message: &'static str,
}

impl CommandError {
    fn invalid_argument() -> Self {
        Self {
            code: "INVALID_ARGUMENT",
            message: "A valid workspace ID is required",
        }
    }

    fn storage_not_initialized() -> Self {
        Self {
            code: "STORAGE_NOT_INITIALIZED",
            message: "Desktop storage is not initialized",
        }
    }

    fn unknown_domain_operation() -> Self {
        Self {
            code: "UNKNOWN_DOMAIN_OPERATION",
            message: "The requested domain operation is not supported",
        }
    }
}

fn validate_workspace(workspace_id: &str) -> Result<(), CommandError> {
    if workspace_id.trim().is_empty() {
        return Err(CommandError::invalid_argument());
    }
    Ok(())
}

fn storage_stub(workspace_id: &str) -> Result<Value, CommandError> {
    validate_workspace(workspace_id)?;
    Err(CommandError::storage_not_initialized())
}

#[tauri::command]
pub fn desktop_bootstrap() -> DesktopBootstrap {
    DesktopBootstrap {
        version: env!("CARGO_PKG_VERSION"),
        platform: "windows",
        storage_available: false,
    }
}

#[tauri::command]
pub fn workspace_query(workspace_id: String, query: Value) -> Result<Value, CommandError> {
    let operation = query.get("type").and_then(Value::as_str);
    if !matches!(
        operation,
        Some(
            "cards.list"
                | "cards.get"
                | "whiteboards.list"
                | "whiteboards.get"
                | "items.list"
                | "records.list"
        )
    ) {
        validate_workspace(&workspace_id)?;
        return Err(CommandError::unknown_domain_operation());
    }
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_execute(workspace_id: String, command: Value) -> Result<Value, CommandError> {
    let operation = command.get("type").and_then(Value::as_str);
    if !matches!(
        operation,
        Some(
            "cards.create"
                | "cards.update"
                | "cards.delete"
                | "whiteboards.create"
                | "whiteboards.update"
                | "whiteboards.delete"
                | "items.create"
                | "items.update"
                | "items.delete"
                | "records.put"
                | "records.delete"
        )
    ) {
        validate_workspace(&workspace_id)?;
        return Err(CommandError::unknown_domain_operation());
    }
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_pending_batches(workspace_id: String, limit: u32) -> Result<Value, CommandError> {
    let _ = limit;
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_acknowledge(
    workspace_id: String,
    change_ids: Vec<String>,
) -> Result<Value, CommandError> {
    let _ = change_ids;
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_apply_remote(
    workspace_id: String,
    batches: Value,
    peer_id: String,
    next_cursor: String,
) -> Result<Value, CommandError> {
    let _ = (batches, peer_id, next_cursor);
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_sync_state(workspace_id: String, peer_id: String) -> Result<Value, CommandError> {
    let _ = peer_id;
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_read_blob(workspace_id: String, hash: String) -> Result<Value, CommandError> {
    let _ = hash;
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_missing_blobs(workspace_id: String) -> Result<Value, CommandError> {
    storage_stub(&workspace_id)
}

#[tauri::command]
pub fn workspace_store_blob(
    workspace_id: String,
    descriptor: Value,
    bytes: Vec<u8>,
) -> Result<Value, CommandError> {
    let _ = (descriptor, bytes);
    storage_stub(&workspace_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bootstrap_reports_storage_unavailable() {
        assert_eq!(
            desktop_bootstrap(),
            DesktopBootstrap {
                version: "0.0.0",
                platform: "windows",
                storage_available: false,
            }
        );
    }

    #[test]
    fn rejects_empty_workspace_ids() {
        let error = workspace_pending_batches("".into(), 25).unwrap_err();
        assert_eq!(error.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn known_commands_return_the_storage_stub() {
        let error =
            workspace_query("workspace-1".into(), json!({ "type": "cards.list" })).unwrap_err();
        assert_eq!(error.code, "STORAGE_NOT_INITIALIZED");
    }

    #[test]
    fn rejects_unknown_domain_operations_before_storage() {
        let error = workspace_execute("workspace-1".into(), json!({})).unwrap_err();
        assert_eq!(error.code, "UNKNOWN_DOMAIN_OPERATION");
    }
}
