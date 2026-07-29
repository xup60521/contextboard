use crate::storage::{BlobDescriptor, Storage, StorageError};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

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
    pub message: String,
}

impl From<StorageError> for CommandError {
    fn from(value: StorageError) -> Self {
        match value {
            StorageError::Invalid(message) => Self {
                code: "INVALID_ARGUMENT",
                message,
            },
            StorageError::UnknownOperation => Self {
                code: "UNKNOWN_DOMAIN_OPERATION",
                message: "The requested domain operation is not supported".into(),
            },
            StorageError::Sql(error) => Self {
                code: "INTERNAL_ERROR",
                message: format!("Desktop storage failed: {error}"),
            },
            StorageError::Io(error) => Self {
                code: "INTERNAL_ERROR",
                message: format!("Desktop blob storage failed: {error}"),
            },
            StorageError::Json(error) => Self {
                code: "INVALID_ARGUMENT",
                message: format!("Invalid JSON payload: {error}"),
            },
        }
    }
}

#[tauri::command]
pub fn desktop_bootstrap() -> DesktopBootstrap {
    DesktopBootstrap {
        version: env!("CARGO_PKG_VERSION"),
        platform: "windows",
        storage_available: true,
    }
}

#[tauri::command]
pub fn workspace_query(
    storage: State<'_, Storage>,
    workspace_id: String,
    query: Value,
) -> Result<Value, CommandError> {
    storage.query(&workspace_id, &query).map_err(Into::into)
}

#[tauri::command]
pub fn workspace_execute(
    storage: State<'_, Storage>,
    workspace_id: String,
    command: Value,
) -> Result<Value, CommandError> {
    storage.execute(&workspace_id, &command).map_err(Into::into)
}

#[tauri::command]
pub fn workspace_pending_batches(
    storage: State<'_, Storage>,
    workspace_id: String,
    limit: u32,
) -> Result<Value, CommandError> {
    storage.pending(&workspace_id, limit).map_err(Into::into)
}

#[tauri::command]
pub fn workspace_acknowledge(
    storage: State<'_, Storage>,
    workspace_id: String,
    change_ids: Vec<String>,
) -> Result<Value, CommandError> {
    storage
        .acknowledge(&workspace_id, &change_ids)
        .map(|_| Value::Null)
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_apply_remote(
    storage: State<'_, Storage>,
    workspace_id: String,
    batches: Value,
    peer_id: String,
    next_cursor: String,
) -> Result<Value, CommandError> {
    storage
        .apply_remote(&workspace_id, &batches, &peer_id, &next_cursor)
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_sync_state(
    storage: State<'_, Storage>,
    workspace_id: String,
    peer_id: String,
) -> Result<Value, CommandError> {
    storage
        .sync_state(&workspace_id, &peer_id)
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_read_blob(
    storage: State<'_, Storage>,
    workspace_id: String,
    hash: String,
) -> Result<Value, CommandError> {
    storage
        .read_blob(&workspace_id, &hash)
        .map(|blob| {
            blob.map_or(
                Value::Null,
                |(descriptor, bytes)| json!({"descriptor":descriptor,"bytes":bytes}),
            )
        })
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_missing_blobs(
    storage: State<'_, Storage>,
    workspace_id: String,
) -> Result<Value, CommandError> {
    storage
        .missing_blobs(&workspace_id)
        .map(|v| json!(v))
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_store_blob(
    storage: State<'_, Storage>,
    workspace_id: String,
    descriptor: BlobDescriptor,
    bytes: Vec<u8>,
) -> Result<Value, CommandError> {
    storage
        .store_blob(&workspace_id, &descriptor, &bytes)
        .map(|_| Value::Null)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_reports_storage_available() {
        assert_eq!(
            desktop_bootstrap(),
            DesktopBootstrap {
                version: "0.0.0",
                platform: "windows",
                storage_available: true,
            }
        );
    }

    #[test]
    fn storage_errors_are_typed_without_leaking_paths_or_sql() {
        let error = CommandError::from(StorageError::Invalid("workspaceId is invalid".into()));
        assert_eq!(error.code, "INVALID_ARGUMENT");
        let unknown = CommandError::from(StorageError::UnknownOperation);
        assert_eq!(unknown.code, "UNKNOWN_DOMAIN_OPERATION");
    }
}
