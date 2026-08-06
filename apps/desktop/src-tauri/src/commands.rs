use crate::agent::{self, AgentError, AgentErrorBody, AgentRequest, AgentServerState, AgentState};
use crate::auth::{self, AuthError, AuthHandoff, AuthHandoffState};
use crate::storage::{BlobDescriptor, Storage, StorageError};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, State};

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

impl From<AgentError> for CommandError {
    fn from(value: AgentError) -> Self {
        Self {
            code: "AGENT_SERVER_FAILED",
            message: value.message,
        }
    }
}

impl From<AuthError> for CommandError {
    fn from(value: AuthError) -> Self {
        match value {
            AuthError::Invalid(message) => Self {
                code: "INVALID_ARGUMENT",
                message,
            },
            AuthError::TimedOut => Self {
                code: "AUTH_TIMED_OUT",
                message: "Sign in timed out. Try again.".into(),
            },
            AuthError::Provider(message) => Self {
                code: "AUTH_FAILED",
                message,
            },
            AuthError::Io(error) => Self {
                code: "INTERNAL_ERROR",
                message: format!("Desktop sign in failed: {}", error.kind()),
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

#[tauri::command]
pub fn workspace_device_id(
    storage: State<'_, Storage>,
    workspace_id: String,
) -> Result<String, CommandError> {
    storage.device(&workspace_id).map_err(Into::into)
}

#[tauri::command]
pub fn workspace_has_data(
    storage: State<'_, Storage>,
    workspace_id: String,
) -> Result<bool, CommandError> {
    storage.has_data(&workspace_id).map_err(Into::into)
}

#[tauri::command]
pub fn workspace_adopt(
    storage: State<'_, Storage>,
    workspace_id: String,
    target_workspace_id: String,
) -> Result<Value, CommandError> {
    storage
        .adopt_workspace(&workspace_id, &target_workspace_id)
        .map(|_| Value::Null)
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_merge(
    storage: State<'_, Storage>,
    from: String,
    to: String,
) -> Result<Value, CommandError> {
    storage.merge_workspace(&from, &to).map_err(Into::into)
}

#[tauri::command]
pub fn workspace_delete(
    storage: State<'_, Storage>,
    workspace_id: String,
) -> Result<Value, CommandError> {
    storage
        .delete_workspace(&workspace_id)
        .map(|_| Value::Null)
        .map_err(Into::into)
}

#[tauri::command]
pub fn workspace_list_local(storage: State<'_, Storage>) -> Result<Vec<String>, CommandError> {
    storage.list_local_workspaces().map_err(Into::into)
}

#[tauri::command]
pub fn desktop_setting(
    storage: State<'_, Storage>,
    key: String,
) -> Result<Option<String>, CommandError> {
    storage.setting(&key).map_err(Into::into)
}

#[tauri::command]
pub fn desktop_set_setting(
    storage: State<'_, Storage>,
    key: String,
    value: String,
) -> Result<Value, CommandError> {
    storage
        .set_setting(&key, &value)
        .map(|_| Value::Null)
        .map_err(Into::into)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentServerStatus {
    pub enabled: bool,
    pub port: Option<u16>,
    /// The port that would be used on the next start, so the settings panel can
    /// show an address before the agent server is switched on.
    pub configured_port: u16,
}

fn bridge_status(
    storage: &Storage,
    state: &AgentServerState,
) -> Result<AgentServerStatus, CommandError> {
    Ok(AgentServerStatus {
        enabled: state.port().is_some(),
        port: state.port(),
        configured_port: agent::configured_port(storage)?,
    })
}

#[tauri::command]
pub fn desktop_bridge_status(
    storage: State<'_, Storage>,
    state: State<'_, AgentServerState>,
) -> Result<AgentServerStatus, CommandError> {
    bridge_status(&storage, &state)
}

/// Turning the local agent server on lets any program on this machine read and write the
/// workspace, so it is off until the user asks for it and the choice is
/// persisted rather than inferred.
#[tauri::command]
pub fn desktop_bridge_set_enabled(
    app: AppHandle,
    storage: State<'_, Storage>,
    state: State<'_, AgentServerState>,
    agent_state: State<'_, AgentState>,
    enabled: bool,
) -> Result<AgentServerStatus, CommandError> {
    if enabled {
        let port = agent::configured_port(&storage)?;
        state.start(port, app)?;
    } else {
        state.stop(&agent_state);
    }
    storage.set_setting(
        agent::ENABLED_SETTING_KEY,
        if enabled { "true" } else { "false" },
    )?;
    bridge_status(&storage, &state)
}

#[tauri::command]
pub fn desktop_agent_subscribe(
    state: State<'_, AgentState>,
    channel: Channel<AgentRequest>,
    tools: Vec<String>,
) -> u64 {
    state.subscribe(channel, tools)
}

#[tauri::command]
pub fn desktop_agent_respond(
    state: State<'_, AgentState>,
    generation: u64,
    id: u64,
    ok: bool,
    result: Option<Value>,
    error: Option<AgentErrorBody>,
) -> Value {
    state.respond(generation, id, ok, result, error);
    Value::Null
}

#[tauri::command]
pub fn desktop_agent_unsubscribe(state: State<'_, AgentState>, generation: u64) -> Value {
    state.unsubscribe(generation);
    Value::Null
}

/// Binds the loopback listener and hands the sign-in page to the user's real
/// browser, so GitHub never sees an embedded webview.
#[tauri::command]
pub fn desktop_auth_start(
    handoff: State<'_, AuthHandoffState>,
    base_url: String,
) -> Result<AuthHandoff, CommandError> {
    let started = handoff.start(&base_url)?;
    tauri_plugin_opener::open_url(started.authorize_url.clone(), None::<&str>).map_err(
        |error| {
            handoff.cancel();
            CommandError {
                code: "AUTH_FAILED",
                message: format!("Unable to open the browser: {error}"),
            }
        },
    )?;
    Ok(started)
}

#[tauri::command]
pub async fn desktop_auth_wait(
    handoff: State<'_, AuthHandoffState>,
) -> Result<String, CommandError> {
    let listener = handoff.take().ok_or(CommandError {
        code: "AUTH_CANCELLED",
        message: "Sign in was not started".into(),
    })?;
    tauri::async_runtime::spawn_blocking(move || auth::wait_for_token(listener))
        .await
        .map_err(|_| CommandError {
            code: "INTERNAL_ERROR",
            message: "Desktop sign in failed".into(),
        })?
        .map_err(Into::into)
}

#[tauri::command]
pub fn desktop_auth_cancel(handoff: State<'_, AuthHandoffState>) -> Value {
    handoff.cancel();
    Value::Null
}

#[tauri::command]
pub fn desktop_auth_store_token(token: String) -> Result<Value, CommandError> {
    auth::store_token(&token)
        .map(|_| Value::Null)
        .map_err(Into::into)
}

#[tauri::command]
pub fn desktop_auth_token() -> Result<Option<String>, CommandError> {
    auth::read_token().map_err(Into::into)
}

#[tauri::command]
pub fn desktop_auth_clear() -> Result<Value, CommandError> {
    auth::clear_token().map(|_| Value::Null).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_errors_are_typed_without_leaking_internals() {
        assert_eq!(
            CommandError::from(AuthError::TimedOut).code,
            "AUTH_TIMED_OUT"
        );
        assert_eq!(
            CommandError::from(AuthError::Provider("access denied".into())).code,
            "AUTH_FAILED"
        );
        let io = CommandError::from(AuthError::Io(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            "127.0.0.1:9 is taken by C:\\secret",
        )));
        assert_eq!(io.code, "INTERNAL_ERROR");
        assert!(!io.message.contains("secret"));
    }

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
