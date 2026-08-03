//! Local agent bridge.
//!
//! Exposes the same allowlisted domain surface the renderer uses
//! (`Storage::query` / `Storage::execute`) over a loopback HTTP endpoint, so an
//! MCP server running on this machine can read and write the workspace while
//! the desktop app owns authentication and synchronization. The bridge adds no
//! capability: it is a second caller of `query_operation` / `command_operation`,
//! and it can no more submit SQL or filesystem paths than the renderer can.
//!
//! There is deliberately no token. A co-located agent is trusted, but
//! "reachable on 127.0.0.1" is not the same as "reachable only by you" — any web
//! page the user visits can issue requests to localhost. The guard therefore
//! comes from the browser's own rules, enforced in [`guard`]:
//!
//! * an `Origin` header is rejected outright — non-browser clients never send one;
//! * `content-type: application/json` is required, which is not a CORS-simple
//!   type, so a cross-origin POST must preflight — and since no CORS headers are
//!   ever returned, that preflight fails before the handler is reached;
//! * `Host` must name loopback, which blocks DNS rebinding;
//! * `GET` is refused, so `<img>`/`<script>` cannot probe the port.
//!
//! If this endpoint ever becomes reachable off-machine, a token stops being
//! optional.

use crate::storage::{Storage, StorageError};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use tauri::{Emitter, Manager};
use tiny_http::{Header, Request, Response, Server};

/// Persisted as a desktop setting so the bridge stays off across restarts
/// unless the user turned it on.
pub const ENABLED_SETTING_KEY: &str = "agentBridgeEnabled";
pub const PORT_SETTING_KEY: &str = "agentBridgePort";
pub const DEFAULT_PORT: u16 = 8787;
pub const WORKSPACE_SETTING_KEY: &str = "workspaceId";
/// Mirrors `DEFAULT_DESKTOP_WORKSPACE_ID` in the renderer.
pub const DEFAULT_WORKSPACE_ID: &str = "contextboard-desktop";

const ENDPOINT: &str = "/bridge/v1";
const MAX_BODY_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct BridgeError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
}

impl BridgeError {
    fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
}

impl From<StorageError> for BridgeError {
    fn from(value: StorageError) -> Self {
        match value {
            StorageError::Invalid(message) => Self::new(400, "INVALID_ARGUMENT", message),
            StorageError::UnknownOperation => Self::new(
                400,
                "UNKNOWN_DOMAIN_OPERATION",
                "The requested domain operation is not supported",
            ),
            // Never surface SQL, IO paths, or serde internals to a caller that
            // is not necessarily the app itself.
            StorageError::Sql(_) | StorageError::Io(_) => {
                Self::new(500, "INTERNAL_ERROR", "Desktop storage failed")
            }
            StorageError::Json(_) => {
                Self::new(400, "INVALID_ARGUMENT", "Invalid JSON payload")
            }
        }
    }
}

/// Request metadata the guard needs, lifted out of `tiny_http` so the
/// security rules can be unit tested without binding a socket.
pub struct RequestHead<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub origin: Option<&'a str>,
    pub host: Option<&'a str>,
    pub content_type: Option<&'a str>,
}

/// The complete network-facing access check. Everything that reaches
/// [`dispatch`] has passed this.
pub fn guard(head: &RequestHead<'_>, port: u16) -> Result<(), BridgeError> {
    if !head.method.eq_ignore_ascii_case("POST") {
        return Err(BridgeError::new(
            405,
            "METHOD_NOT_ALLOWED",
            "The agent bridge accepts POST only",
        ));
    }
    let path = head.url.split(['?', '#']).next().unwrap_or(head.url);
    if path != ENDPOINT {
        return Err(BridgeError::new(404, "NOT_FOUND", "Unknown endpoint"));
    }
    // A browser attaches Origin to every cross-origin request; a CLI never does.
    if head.origin.is_some() {
        return Err(BridgeError::new(
            403,
            "FORBIDDEN_ORIGIN",
            "The agent bridge does not serve browser origins",
        ));
    }
    let content_type = head.content_type.unwrap_or_default();
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim();
    if !media_type.eq_ignore_ascii_case("application/json") {
        return Err(BridgeError::new(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Content-Type must be application/json",
        ));
    }
    if !is_loopback_host(head.host.unwrap_or_default(), port) {
        return Err(BridgeError::new(
            403,
            "FORBIDDEN_HOST",
            "The agent bridge only serves loopback hosts",
        ));
    }
    Ok(())
}

/// Blocks DNS rebinding: a name that resolves to 127.0.0.1 still arrives with
/// its own Host header, and only literal loopback names are accepted.
fn is_loopback_host(host: &str, port: u16) -> bool {
    let host = host.trim();
    let (name, host_port) = match host.rsplit_once(':') {
        Some((name, value)) => (name, value.parse::<u16>().ok()),
        None => (host, None),
    };
    if host_port != Some(port) {
        return false;
    }
    matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

/// Routes a validated request body. `workspaceId` is optional: the bridge
/// resolves the app's active workspace itself, so an agent never has to be told
/// which workspace it is talking to.
pub fn dispatch(storage: &Storage, body: &Value) -> Result<Value, BridgeError> {
    let op = body
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| BridgeError::new(400, "INVALID_ARGUMENT", "A bridge op is required"))?;

    if op == "status" {
        return Ok(json!({
            "workspaceId": active_workspace(storage)?,
            "version": env!("CARGO_PKG_VERSION"),
            "protocol": 1,
        }));
    }

    let workspace_id = match body.get("workspaceId").and_then(Value::as_str) {
        Some(value) => value.to_string(),
        None => active_workspace(storage)?,
    };
    let payload = body.get("payload").ok_or_else(|| {
        BridgeError::new(400, "INVALID_ARGUMENT", "A bridge payload is required")
    })?;

    match op {
        "query" => Ok(storage.query(&workspace_id, payload)?),
        "execute" => Ok(storage.execute(&workspace_id, payload)?),
        _ => Err(BridgeError::new(
            400,
            "UNKNOWN_OP",
            "Bridge op must be status, query, or execute",
        )),
    }
}

/// True when this request body would change the workspace. Mirrors how
/// [`dispatch`] reads the op so the two cannot disagree about what a write is.
pub fn is_write_op(body: &Value) -> bool {
    body.get("op").and_then(Value::as_str) == Some("execute")
}

/// The port the bridge should bind, honouring an override the user set.
pub fn configured_port(storage: &Storage) -> Result<u16, BridgeError> {
    Ok(storage
        .setting(PORT_SETTING_KEY)?
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_PORT))
}

/// Off unless explicitly turned on. A stored value that is anything other than
/// `"true"` keeps the bridge closed, so a corrupt setting fails safe.
pub fn is_enabled(storage: &Storage) -> Result<bool, BridgeError> {
    Ok(storage
        .setting(ENABLED_SETTING_KEY)?
        .is_some_and(|value| value == "true"))
}

fn active_workspace(storage: &Storage) -> Result<String, BridgeError> {
    Ok(storage
        .setting(WORKSPACE_SETTING_KEY)?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_WORKSPACE_ID.to_string()))
}

/// Handle to the running listener. Dropping it, or calling
/// [`BridgeState::stop`], unblocks the accept loop and frees the port.
struct RunningBridge {
    port: u16,
    server: Arc<Server>,
}

#[derive(Default)]
pub struct BridgeState {
    running: Mutex<Option<RunningBridge>>,
}

impl BridgeState {
    pub fn port(&self) -> Option<u16> {
        self.running
            .lock()
            .expect("bridge mutex poisoned")
            .as_ref()
            .map(|bridge| bridge.port)
    }

    /// Binds the loopback listener and serves until [`stop`](Self::stop).
    /// Idempotent: starting an already-running bridge returns its port.
    ///
    /// Storage is resolved from the app handle per request rather than held by
    /// the worker, so the bridge never outlives or pins the managed state.
    pub fn start(&self, port: u16, app: tauri::AppHandle) -> Result<u16, BridgeError> {
        let mut running = self.running.lock().expect("bridge mutex poisoned");
        if let Some(bridge) = running.as_ref() {
            return Ok(bridge.port);
        }
        // Loopback only. Binding 0.0.0.0 would expose the workspace to the LAN.
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let server = Server::http(address).map_err(|error| {
            BridgeError::new(
                500,
                "BRIDGE_BIND_FAILED",
                format!("Unable to start the agent bridge on port {port}: {error}"),
            )
        })?;
        let server = Arc::new(server);
        let bound = server
            .server_addr()
            .to_ip()
            .map(|address| address.port())
            .unwrap_or(port);
        let worker = Arc::clone(&server);
        thread::Builder::new()
            .name("contextboard-agent-bridge".into())
            .spawn(move || {
                // `recv` returns Err once the server is unblocked on stop.
                while let Ok(request) = worker.recv() {
                    let storage = app.state::<Storage>();
                    // A bridge write is another *local* writer changing this
                    // workspace's SQLite, so the renderer both repaints and
                    // pushes. A renderer that isn't listening must not fail the
                    // agent's write — the sync poll timer stays the backstop.
                    serve(&storage, request, bound, || {
                        let _ = app.emit("contextboard://workspace-changed", ());
                    });
                }
            })
            .map_err(|error| {
                BridgeError::new(
                    500,
                    "BRIDGE_BIND_FAILED",
                    format!("Unable to start the agent bridge worker: {error}"),
                )
            })?;
        *running = Some(RunningBridge {
            port: bound,
            server,
        });
        drop(running);
        write_discovery_file(bound);
        Ok(bound)
    }

    pub fn stop(&self) {
        let taken = self
            .running
            .lock()
            .expect("bridge mutex poisoned")
            .take();
        if let Some(bridge) = taken {
            bridge.server.unblock();
            remove_discovery_file();
        }
    }
}

fn serve(storage: &Storage, mut request: Request, port: u16, notify: impl Fn()) {
    let header = |name: &str| {
        request
            .headers()
            .iter()
            .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
            .map(|header| header.value.as_str().to_string())
    };
    let origin = header("Origin");
    let host = header("Host");
    let content_type = header("Content-Type");
    let head = RequestHead {
        method: request.method().as_str(),
        url: request.url(),
        origin: origin.as_deref(),
        host: host.as_deref(),
        content_type: content_type.as_deref(),
    };

    let mut was_write = false;
    let outcome = guard(&head, port).and_then(|_| {
        let mut body = String::new();
        request
            .as_reader()
            .take(MAX_BODY_BYTES)
            .read_to_string(&mut body)
            .map_err(|_| BridgeError::new(400, "INVALID_ARGUMENT", "Unable to read the request"))?;
        let parsed: Value = serde_json::from_str(&body)
            .map_err(|_| BridgeError::new(400, "INVALID_ARGUMENT", "Request body must be JSON"))?;
        was_write = is_write_op(&parsed);
        dispatch(storage, &parsed)
    });

    // Only a write that actually landed is worth waking the renderer for.
    if was_write && outcome.is_ok() {
        notify();
    }

    let (status, payload) = match outcome {
        Ok(result) => (200, json!({ "ok": true, "result": result })),
        Err(error) => (
            error.status,
            json!({
                "ok": false,
                "error": { "code": error.code, "message": error.message },
            }),
        ),
    };
    // No CORS headers, ever: their absence is what makes a cross-origin
    // preflight fail before the handler is reached.
    let response = Response::from_string(payload.to_string())
        .with_status_code(status)
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                .expect("static header"),
        );
    let _ = request.respond(response);
}

/// Publishes the live port so the MCP server can find the bridge without being
/// configured. Best-effort: a failure here only costs auto-discovery.
fn write_discovery_file(port: u16) {
    let Some(path) = discovery_path() else { return };
    let Some(parent) = path.parent() else { return };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let _ = fs::write(&path, json!({ "port": port }).to_string());
}

fn remove_discovery_file() {
    if let Some(path) = discovery_path() {
        let _ = fs::remove_file(path);
    }
}

pub fn discovery_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".contextboard").join("bridge.json"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head<'a>(method: &'a str, url: &'a str) -> RequestHead<'a> {
        RequestHead {
            method,
            url,
            origin: None,
            host: Some("127.0.0.1:8787"),
            content_type: Some("application/json"),
        }
    }

    #[test]
    fn accepts_a_well_formed_loopback_post() {
        assert_eq!(guard(&head("POST", ENDPOINT), 8787), Ok(()));
    }

    #[test]
    fn accepts_a_charset_suffixed_content_type() {
        let mut request = head("POST", ENDPOINT);
        request.content_type = Some("application/json; charset=utf-8");
        assert_eq!(guard(&request, 8787), Ok(()));
    }

    #[test]
    fn accepts_localhost_and_ipv6_loopback_hosts() {
        for host in ["localhost:8787", "[::1]:8787", " 127.0.0.1:8787 "] {
            let mut request = head("POST", ENDPOINT);
            request.host = Some(host);
            assert_eq!(guard(&request, 8787), Ok(()), "host {host} should pass");
        }
    }

    // A page the user is merely visiting must not be able to reach the
    // workspace, which is the entire reason the bridge can skip a token.
    #[test]
    fn rejects_requests_carrying_a_browser_origin() {
        let mut request = head("POST", ENDPOINT);
        request.origin = Some("https://example.com");
        assert_eq!(guard(&request, 8787).unwrap_err().status, 403);
    }

    #[test]
    fn rejects_form_content_types_that_would_skip_preflight() {
        for value in [
            "text/plain",
            "application/x-www-form-urlencoded",
            "multipart/form-data",
        ] {
            let mut request = head("POST", ENDPOINT);
            request.content_type = Some(value);
            assert_eq!(
                guard(&request, 8787).unwrap_err().status,
                415,
                "{value} must not be accepted"
            );
        }
    }

    #[test]
    fn rejects_a_missing_content_type() {
        let mut request = head("POST", ENDPOINT);
        request.content_type = None;
        assert_eq!(guard(&request, 8787).unwrap_err().status, 415);
    }

    #[test]
    fn rejects_rebound_dns_names() {
        for host in ["evil.example.com:8787", "contextboard.local:8787", ""] {
            let mut request = head("POST", ENDPOINT);
            request.host = Some(host);
            assert_eq!(
                guard(&request, 8787).unwrap_err().status,
                403,
                "host {host} must not be accepted"
            );
        }
    }

    #[test]
    fn rejects_a_loopback_host_naming_a_different_port() {
        let mut request = head("POST", ENDPOINT);
        request.host = Some("127.0.0.1:9999");
        assert_eq!(guard(&request, 8787).unwrap_err().status, 403);
    }

    #[test]
    fn refuses_get_so_markup_cannot_probe_the_port() {
        assert_eq!(guard(&head("GET", ENDPOINT), 8787).unwrap_err().status, 405);
    }

    #[test]
    fn refuses_unknown_paths() {
        assert_eq!(guard(&head("POST", "/"), 8787).unwrap_err().status, 404);
    }

    #[test]
    fn matches_the_endpoint_ignoring_the_query_string() {
        assert_eq!(guard(&head("POST", "/bridge/v1?trace=1"), 8787), Ok(()));
    }

    #[test]
    fn storage_errors_do_not_leak_sql_or_paths() {
        let error = BridgeError::from(StorageError::Sql(rusqlite::Error::InvalidQuery));
        assert_eq!(error.status, 500);
        assert_eq!(error.message, "Desktop storage failed");
    }

    fn temp_storage() -> (Storage, tempfile::TempDir) {
        let directory = tempfile::tempdir().expect("temp dir");
        let storage = Storage::open(directory.path()).expect("storage");
        (storage, directory)
    }

    #[test]
    fn is_disabled_until_the_user_turns_it_on() {
        let (storage, _guard) = temp_storage();
        assert!(!is_enabled(&storage).expect("read setting"));
    }

    #[test]
    fn a_corrupt_enabled_setting_fails_closed() {
        let (storage, _guard) = temp_storage();
        // Storage rejects empty values, so every reachable non-"true" value.
        for value in ["yes", "1", "TRUE", "maybe"] {
            storage
                .set_setting(ENABLED_SETTING_KEY, value)
                .expect("set setting");
            assert!(
                !is_enabled(&storage).expect("read setting"),
                "{value} must not enable the bridge"
            );
        }
        storage
            .set_setting(ENABLED_SETTING_KEY, "true")
            .expect("set setting");
        assert!(is_enabled(&storage).expect("read setting"));
    }

    #[test]
    fn falls_back_to_the_default_port_when_the_override_is_unusable() {
        let (storage, _guard) = temp_storage();
        assert_eq!(configured_port(&storage).expect("port"), DEFAULT_PORT);
        for value in ["0", "-1", "notaport", "70000"] {
            storage
                .set_setting(PORT_SETTING_KEY, value)
                .expect("set setting");
            assert_eq!(configured_port(&storage).expect("port"), DEFAULT_PORT);
        }
        storage
            .set_setting(PORT_SETTING_KEY, "9911")
            .expect("set setting");
        assert_eq!(configured_port(&storage).expect("port"), 9911);
    }

    #[test]
    fn status_reports_the_default_workspace_before_one_is_chosen() {
        let (storage, _guard) = temp_storage();
        let result = dispatch(&storage, &json!({ "op": "status" })).expect("status");
        assert_eq!(result["workspaceId"], DEFAULT_WORKSPACE_ID);
    }

    #[test]
    fn status_follows_the_workspace_the_app_adopted() {
        let (storage, _guard) = temp_storage();
        storage
            .set_setting(WORKSPACE_SETTING_KEY, "workspace-from-server")
            .expect("set workspace");
        let result = dispatch(&storage, &json!({ "op": "status" })).expect("status");
        assert_eq!(result["workspaceId"], "workspace-from-server");
    }

    #[test]
    fn query_defaults_to_the_active_workspace() {
        let (storage, _guard) = temp_storage();
        let result = dispatch(
            &storage,
            &json!({ "op": "query", "payload": { "type": "cards.list", "input": {} } }),
        )
        .expect("query");
        assert_eq!(result, json!([]));
    }

    // The bridge must not widen the renderer's allowlist.
    #[test]
    fn rejects_operations_outside_the_existing_allowlist() {
        let (storage, _guard) = temp_storage();
        let error = dispatch(
            &storage,
            &json!({ "op": "query", "payload": { "type": "secrets.list", "input": {} } }),
        )
        .expect_err("must reject");
        assert_eq!(error.code, "UNKNOWN_DOMAIN_OPERATION");
    }

    // Only a write may wake the renderer; a read or a malformed body must not.
    #[test]
    fn only_execute_counts_as_a_write() {
        assert!(is_write_op(&json!({ "op": "execute", "payload": {} })));
        assert!(!is_write_op(&json!({ "op": "query", "payload": {} })));
        assert!(!is_write_op(&json!({ "op": "status" })));
        assert!(!is_write_op(&json!({ "op": 7 })));
        assert!(!is_write_op(&json!({})));
        assert!(!is_write_op(&json!("execute")));
    }

    #[test]
    fn rejects_unknown_bridge_ops() {
        let (storage, _guard) = temp_storage();
        let error = dispatch(&storage, &json!({ "op": "drop", "payload": {} }))
            .expect_err("must reject");
        assert_eq!(error.code, "UNKNOWN_OP");
    }

    #[test]
    fn round_trips_a_card_through_execute_and_query() {
        let (storage, _guard) = temp_storage();
        dispatch(
            &storage,
            &json!({
                "op": "execute",
                "payload": {
                    "type": "cards.upsert",
                    "input": { "value": { "id": "card-1", "content": { "type": "doc" } } },
                },
            }),
        )
        .expect("execute");
        let result = dispatch(
            &storage,
            &json!({ "op": "query", "payload": { "type": "cards.get", "input": { "id": "card-1" } } }),
        )
        .expect("query");
        assert_eq!(result["id"], "card-1");
    }
}
