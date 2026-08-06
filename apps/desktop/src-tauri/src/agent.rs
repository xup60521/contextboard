//! The desktop agent server.
//!
//! The loopback listener is deliberately only a transport boundary. Tool
//! execution happens in the renderer through a Tauri Channel, which means
//! desktop writes use the renderer repository and its normal sync lifecycle.
//!
//! The TypeScript headless server has a twin guard in
//! apps/agent-server/src/guard.ts; keep the two guards in sync.

use crate::storage::{Storage, StorageError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::{ipc::Channel, AppHandle, Manager};
use tiny_http::{Header, Request, Response, Server};

/// Persisted as a desktop setting so the agent server stays off across
/// restarts unless the user turned it on.
pub const ENABLED_SETTING_KEY: &str = "agentBridgeEnabled";
pub const PORT_SETTING_KEY: &str = "agentBridgePort";
pub const DEFAULT_PORT: u16 = 8787;
pub const WORKSPACE_SETTING_KEY: &str = "workspaceId";
/// Mirrors DEFAULT_DESKTOP_WORKSPACE_ID in the renderer.
pub const DEFAULT_WORKSPACE_ID: &str = "contextboard-desktop";

const API_PREFIX: &str = "/api/v1";
const HEALTH_ENDPOINT: &str = "/api/v1/_health";
const TOOLS_ENDPOINT: &str = "/api/v1/_tools";
const SKILL_ENDPOINT: &str = "/api/v1/_skill";
const SKILL_MARKDOWN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../skills/contextboard/SKILL.md"
));
const MAX_BODY_BYTES: u64 = 8 * 1024 * 1024;
const RENDERER_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_IN_FLIGHT: usize = 16;
const JSON_CONTENT_TYPE: &[u8] = b"application/json; charset=utf-8";
const MARKDOWN_CONTENT_TYPE: &[u8] = b"text/markdown; charset=utf-8";

#[derive(Debug, PartialEq, Eq)]
pub struct AgentError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
}

impl AgentError {
    fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
}

impl From<StorageError> for AgentError {
    fn from(value: StorageError) -> Self {
        match value {
            StorageError::Invalid(message) => Self::new(400, "INVALID_ARGUMENT", message),
            StorageError::UnknownOperation => Self::new(
                400,
                "UNKNOWN_DOMAIN_OPERATION",
                "The requested domain operation is not supported",
            ),
            StorageError::Sql(_) | StorageError::Io(_) => {
                Self::new(500, "INTERNAL_ERROR", "Desktop storage failed")
            }
            StorageError::Json(_) => Self::new(400, "INVALID_ARGUMENT", "Invalid JSON payload"),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    pub id: u64,
    pub tool: String,
    pub input: Value,
}

#[derive(Debug)]
enum AgentReply {
    Success(Value),
    Failure(AgentErrorBody),
}

struct Subscriber {
    channel: Channel<AgentRequest>,
    generation: u64,
    tools: Vec<String>,
}

/// Renderer-side request broker. It is independent of the HTTP listener, so
/// lifecycle and concurrency behavior can be tested without a socket/webview.
#[derive(Default)]
pub struct AgentState {
    inner: Mutex<Option<Subscriber>>,
    pending: Mutex<HashMap<u64, Sender<AgentReply>>>,
    next_id: AtomicU64,
    generation: AtomicU64,
    in_flight: AtomicUsize,
}

impl AgentState {
    pub fn subscribe(&self, channel: Channel<AgentRequest>, tools: Vec<String>) -> u64 {
        let mut subscriber = self.inner.lock().expect("agent subscriber mutex poisoned");
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut pending = self.pending.lock().expect("agent pending mutex poisoned");
        fail_pending(
            &mut pending,
            AgentErrorBody {
                code: "RENDERER_RESET".into(),
                message: "the workspace changed mid-request; retry".into(),
            },
        );
        *subscriber = Some(Subscriber {
            channel,
            generation,
            tools,
        });
        generation
    }

    pub fn unsubscribe(&self, generation: u64) {
        let mut subscriber = self.inner.lock().expect("agent subscriber mutex poisoned");
        if subscriber
            .as_ref()
            .map_or(true, |current| current.generation != generation)
        {
            return;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        let mut pending = self.pending.lock().expect("agent pending mutex poisoned");
        fail_pending(
            &mut pending,
            AgentErrorBody {
                code: "RENDERER_RESET".into(),
                message: "The renderer subscription ended; retry".into(),
            },
        );
        *subscriber = None;
    }

    /// Invalidates the renderer subscription when the listener is stopped.
    pub fn reset(&self) {
        let mut subscriber = self.inner.lock().expect("agent subscriber mutex poisoned");
        self.generation.fetch_add(1, Ordering::SeqCst);
        let mut pending = self.pending.lock().expect("agent pending mutex poisoned");
        fail_pending(
            &mut pending,
            AgentErrorBody {
                code: "RENDERER_RESET".into(),
                message: "The renderer subscription ended; retry".into(),
            },
        );
        *subscriber = None;
    }

    pub fn tools(&self) -> Result<Vec<String>, AgentError> {
        self.inner
            .lock()
            .expect("agent subscriber mutex poisoned")
            .as_ref()
            .map(|subscriber| subscriber.tools.clone())
            .ok_or_else(renderer_unavailable)
    }

    pub fn try_begin_request(&self) -> bool {
        let previous = self.in_flight.fetch_add(1, Ordering::AcqRel);
        if previous < MAX_IN_FLIGHT {
            true
        } else {
            self.in_flight.fetch_sub(1, Ordering::AcqRel);
            false
        }
    }

    pub fn finish_request(&self) {
        self.in_flight.fetch_sub(1, Ordering::AcqRel);
    }

    pub fn respond(
        &self,
        generation: u64,
        id: u64,
        ok: bool,
        result: Option<Value>,
        error: Option<AgentErrorBody>,
    ) -> bool {
        let subscriber = self.inner.lock().expect("agent subscriber mutex poisoned");
        if subscriber
            .as_ref()
            .map_or(true, |current| current.generation != generation)
        {
            return false;
        }
        let sender = self
            .pending
            .lock()
            .expect("agent pending mutex poisoned")
            .remove(&id);
        let Some(sender) = sender else {
            return false;
        };
        let reply = if ok {
            AgentReply::Success(result.unwrap_or(Value::Null))
        } else {
            AgentReply::Failure(error.unwrap_or_else(|| AgentErrorBody {
                code: "INTERNAL_ERROR".into(),
                message: "The renderer returned an invalid tool error".into(),
            }))
        };
        sender.send(reply).is_ok()
    }

    pub fn call(&self, tool: &str, input: Value, timeout: Duration) -> Result<Value, AgentError> {
        let (sender, receiver) = mpsc::channel();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let subscriber = self.inner.lock().expect("agent subscriber mutex poisoned");
            let current = subscriber.as_ref().ok_or_else(renderer_unavailable)?;
            if !current.tools.iter().any(|name| name == tool) {
                return Err(AgentError::new(
                    404,
                    "UNKNOWN_TOOL",
                    format!("Unknown tool: {tool}"),
                ));
            }
            let mut pending = self.pending.lock().expect("agent pending mutex poisoned");
            pending.insert(id, sender);
            if current
                .channel
                .send(AgentRequest {
                    id,
                    tool: tool.to_string(),
                    input,
                })
                .is_err()
            {
                pending.remove(&id);
                return Err(renderer_unavailable());
            }
        }

        match receiver.recv_timeout(timeout) {
            Ok(AgentReply::Success(result)) => Ok(result),
            Ok(AgentReply::Failure(error)) => Err(agent_error_from_body(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending
                    .lock()
                    .expect("agent pending mutex poisoned")
                    .remove(&id);
                Err(AgentError::new(
                    504,
                    "RENDERER_TIMEOUT",
                    "The renderer did not respond within 30 seconds",
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.pending
                    .lock()
                    .expect("agent pending mutex poisoned")
                    .remove(&id);
                Err(renderer_unavailable())
            }
        }
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        self.pending
            .lock()
            .expect("agent pending mutex poisoned")
            .len()
    }
}

fn fail_pending(pending: &mut HashMap<u64, Sender<AgentReply>>, error: AgentErrorBody) {
    for (_, sender) in pending.drain() {
        let _ = sender.send(AgentReply::Failure(error.clone()));
    }
}

fn renderer_unavailable() -> AgentError {
    AgentError::new(
        503,
        "RENDERER_UNAVAILABLE",
        "Open the ContextBoard window; the renderer-backed agent server is unavailable",
    )
}

fn agent_error_from_body(error: AgentErrorBody) -> AgentError {
    let (status, code) = match error.code.as_str() {
        "UNKNOWN_TOOL" => (404, "UNKNOWN_TOOL"),
        "INVALID_ARGUMENT" => (400, "INVALID_ARGUMENT"),
        "RENDERER_UNAVAILABLE" => (503, "RENDERER_UNAVAILABLE"),
        "RENDERER_RESET" => (503, "RENDERER_RESET"),
        "RENDERER_TIMEOUT" => (504, "RENDERER_TIMEOUT"),
        _ => (500, "INTERNAL_ERROR"),
    };
    AgentError::new(status, code, error.message)
}

/// Request metadata the guard needs, lifted out of tiny_http so the security
/// rules can be unit tested without binding a socket.
pub struct RequestHead<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub origin: Option<&'a str>,
    pub host: Option<&'a str>,
    pub content_type: Option<&'a str>,
}

/// The complete network-facing access check. This is the Rust twin of
/// apps/agent-server/src/guard.ts.
pub fn guard(head: &RequestHead<'_>, port: u16) -> Result<(), AgentError> {
    let path = head.url.split(['?', '#']).next().unwrap_or(head.url);
    if path != HEALTH_ENDPOINT
        && path != TOOLS_ENDPOINT
        && !path.starts_with(&format!("{API_PREFIX}/"))
    {
        return Err(AgentError::new(404, "NOT_FOUND", "Unknown agent endpoint"));
    }
    // GET is refused even for discovery: an <img> or <script> cannot read the
    // response, but it can still time it and probe whether ContextBoard is
    // running on the loopback port.
    if !head.method.eq_ignore_ascii_case("POST") {
        return Err(AgentError::new(
            405,
            "METHOD_NOT_ALLOWED",
            "The agent server accepts POST only",
        ));
    }
    if head.origin.is_some() {
        return Err(AgentError::new(
            403,
            "FORBIDDEN_ORIGIN",
            "The local agent server does not serve browser origins",
        ));
    }
    if !is_loopback_host(head.host.unwrap_or_default(), port) {
        return Err(AgentError::new(
            403,
            "FORBIDDEN_HOST",
            "The local agent server only serves loopback hosts",
        ));
    }
    let media_type = head
        .content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim();
    if !media_type.eq_ignore_ascii_case("application/json") {
        return Err(AgentError::new(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Content-Type must be application/json",
        ));
    }
    Ok(())
}

fn is_loopback_host(host: &str, port: u16) -> bool {
    let host = host.trim();
    let (name, host_port) = match host.rsplit_once(':') {
        Some((name, value)) => (name, value.parse::<u16>().ok()),
        None => (host, None),
    };
    host_port == Some(port) && matches!(name, "127.0.0.1" | "localhost" | "[::1]" | "::1")
}

/// The port the agent server should bind, honouring an override the user set.
pub fn configured_port(storage: &Storage) -> Result<u16, AgentError> {
    Ok(storage
        .setting(PORT_SETTING_KEY)?
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_PORT))
}

/// Off unless explicitly turned on. A stored value that is anything other than
/// "true" keeps the agent server closed, so corrupt settings fail safe.
pub fn is_enabled(storage: &Storage) -> Result<bool, AgentError> {
    Ok(storage
        .setting(ENABLED_SETTING_KEY)?
        .is_some_and(|value| value == "true"))
}

pub fn active_workspace(storage: &Storage) -> Result<String, AgentError> {
    Ok(storage
        .setting(WORKSPACE_SETTING_KEY)?
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_WORKSPACE_ID.to_string()))
}

#[derive(PartialEq, Eq)]
struct DiscoveryIdentity {
    length: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
}

struct DiscoveryLease {
    path: PathBuf,
    identity: DiscoveryIdentity,
}

struct RunningAgentServer {
    port: u16,
    server: Arc<Server>,
    discovery: Option<DiscoveryLease>,
}

/// Owns the loopback listener. Renderer request state is kept separately so
/// commands can register a webview even while the socket is already running.
#[derive(Default)]
pub struct AgentServerState {
    running: Mutex<Option<RunningAgentServer>>,
}

impl AgentServerState {
    pub fn port(&self) -> Option<u16> {
        self.running
            .lock()
            .expect("agent server mutex poisoned")
            .as_ref()
            .map(|server| server.port)
    }

    pub fn start(&self, port: u16, app: AppHandle) -> Result<u16, AgentError> {
        let mut running = self.running.lock().expect("agent server mutex poisoned");
        if let Some(server) = running.as_ref() {
            return Ok(server.port);
        }

        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let server = Server::http(address).map_err(|error| {
            AgentError::new(
                500,
                "AGENT_SERVER_BIND_FAILED",
                format!("Unable to start the local agent server on port {port}: {error}"),
            )
        })?;
        let server = Arc::new(server);
        let bound = server
            .server_addr()
            .to_ip()
            .map(|address| address.port())
            .unwrap_or(port);
        let worker = Arc::clone(&server);
        let worker_app = app.clone();
        thread::Builder::new()
            .name("contextboard-agent-server".into())
            .spawn(move || {
                while let Ok(request) = worker.recv() {
                    if is_agent_api_path(request.url()) {
                        let request_app = worker_app.clone();
                        let state = request_app.state::<AgentState>();
                        if !state.try_begin_request() {
                            respond_error(
                                request,
                                AgentError::new(
                                    503,
                                    "SERVER_BUSY",
                                    "The local agent server is busy; retry",
                                ),
                            );
                            continue;
                        }
                        let _ = thread::Builder::new()
                            .name("contextboard-agent-request".into())
                            .spawn(move || {
                                serve(&request_app, request, bound);
                                request_app.state::<AgentState>().finish_request();
                            });
                    } else {
                        serve(&worker_app, request, bound);
                    }
                }
            })
            .map_err(|error| {
                AgentError::new(
                    500,
                    "AGENT_SERVER_BIND_FAILED",
                    format!("Unable to start the local agent server worker: {error}"),
                )
            })?;

        let discovery = write_discovery_file(bound);
        *running = Some(RunningAgentServer {
            port: bound,
            server,
            discovery,
        });
        Ok(bound)
    }

    pub fn stop(&self, agent: &AgentState) {
        let taken = self
            .running
            .lock()
            .expect("agent server mutex poisoned")
            .take();
        if let Some(server) = taken {
            server.server.unblock();
            agent.reset();
            if let Some(discovery) = server.discovery {
                remove_discovery_file(discovery, server.port);
            }
        }
    }
}

enum Served {
    Discovery(Value),
    Tool(Value),
    Skill { body: &'static str, etag: String },
}

fn serve(app: &AppHandle, mut request: Request, port: u16) {
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
    let url = request.url().to_string();
    let head = RequestHead {
        method: request.method().as_str(),
        url: &url,
        origin: origin.as_deref(),
        host: host.as_deref(),
        content_type: content_type.as_deref(),
    };

    let outcome = guard(&head, port).and_then(|_| {
        let mut body = String::new();
        request
            .as_reader()
            .take(MAX_BODY_BYTES)
            .read_to_string(&mut body)
            .map_err(|_| AgentError::new(400, "INVALID_ARGUMENT", "Unable to read the request"))?;
        let parsed: Value = serde_json::from_str(&body)
            .map_err(|_| AgentError::new(400, "INVALID_ARGUMENT", "Request body must be JSON"))?;
        let input = parsed.as_object().ok_or_else(|| {
            AgentError::new(
                400,
                "INVALID_ARGUMENT",
                "Request body must be a JSON object",
            )
        })?;
        let path = path_without_suffix(&url);

        if path == HEALTH_ENDPOINT {
            if !input.is_empty() {
                return Err(AgentError::new(
                    400,
                    "INVALID_ARGUMENT",
                    "Discovery requests require an empty JSON object",
                ));
            }
            let storage = app.state::<Storage>();
            return Ok(Served::Discovery(json!({
                "ok": true,
                "mode": "desktop",
                "workspaceId": active_workspace(&storage)?,
                "version": env!("CARGO_PKG_VERSION"),
                "port": port,
            })));
        }
        if path == TOOLS_ENDPOINT {
            if !input.is_empty() {
                return Err(AgentError::new(
                    400,
                    "INVALID_ARGUMENT",
                    "Discovery requests require an empty JSON object",
                ));
            }
            let tools = app.state::<AgentState>().tools()?;
            return Ok(Served::Discovery(json!(tools)));
        }
        if path == SKILL_ENDPOINT {
            if !input.is_empty() {
                return Err(AgentError::new(
                    400,
                    "INVALID_ARGUMENT",
                    "Discovery requests require an empty JSON object",
                ));
            }
            return Ok(Served::Skill {
                body: SKILL_MARKDOWN,
                etag: skill_etag(),
            });
        }

        let tool = path.strip_prefix("/api/v1/").unwrap_or_default();
        let result = app
            .state::<AgentState>()
            .call(tool, parsed, RENDERER_TIMEOUT)?;
        Ok(Served::Tool(result))
    });

    match outcome {
        Ok(Served::Skill { body, etag }) => respond_markdown(request, body, &etag),
        Ok(Served::Discovery(result)) => respond_payload(request, 200, result),
        Ok(Served::Tool(result)) => {
            respond_payload(request, 200, json!({ "ok": true, "result": result }))
        }
        Err(error) => respond_payload(
            request,
            error.status,
            json!({
                "ok": false,
                "error": { "code": error.code, "message": error.message },
            }),
        ),
    }
}

fn respond_error(request: Request, error: AgentError) {
    respond_payload(
        request,
        error.status,
        json!({
            "ok": false,
            "error": { "code": error.code, "message": error.message },
        }),
    );
}

fn respond_payload(request: Request, status: u16, payload: Value) {
    let response = Response::from_string(payload.to_string())
        .with_status_code(status)
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], JSON_CONTENT_TYPE).expect("static header"),
        );
    let _ = request.respond(response);
}

fn respond_markdown(request: Request, body: &'static str, etag: &str) {
    let response = Response::from_string(body.to_string())
        .with_status_code(200)
        .with_header(
            Header::from_bytes(&b"Content-Type"[..], MARKDOWN_CONTENT_TYPE).expect("static header"),
        )
        .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).expect("etag header"));
    let _ = request.respond(response);
}

fn skill_etag() -> String {
    format!(
        "\"{}\"",
        hex::encode(Sha256::digest(SKILL_MARKDOWN.as_bytes()))
    )
}

fn path_without_suffix(url: &str) -> &str {
    url.split(['?', '#']).next().unwrap_or(url)
}

fn is_agent_api_path(url: &str) -> bool {
    let path = path_without_suffix(url);
    path == HEALTH_ENDPOINT || path == TOOLS_ENDPOINT || path.starts_with(&format!("{API_PREFIX}/"))
}

fn write_discovery_file(port: u16) -> Option<DiscoveryLease> {
    let path = discovery_path()?;
    let parent = path.parent()?;
    if fs::create_dir_all(parent).is_err() {
        return None;
    }
    if fs::write(
        &path,
        json!({ "port": port, "mode": "desktop" }).to_string(),
    )
    .is_err()
    {
        return None;
    }
    Some(DiscoveryLease {
        identity: discovery_identity(&path)?,
        path,
    })
}

fn remove_discovery_file(lease: DiscoveryLease, port: u16) {
    let Some(current) = discovery_identity(&lease.path) else {
        return;
    };
    if current != lease.identity {
        return;
    }
    let Ok(contents) = fs::read_to_string(&lease.path) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<Value>(&contents) else {
        return;
    };
    if value.get("port").and_then(Value::as_u64) != Some(port as u64)
        || value.get("mode").and_then(Value::as_str) != Some("desktop")
    {
        return;
    }
    let _ = fs::remove_file(lease.path);
}

fn discovery_identity(path: &PathBuf) -> Option<DiscoveryIdentity> {
    let metadata = fs::metadata(path).ok()?;
    Some(DiscoveryIdentity {
        length: metadata.len(),
        modified: metadata.modified().ok(),
        created: metadata.created().ok(),
    })
}

pub fn discovery_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".contextboard").join("agent-server.json"))
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

    fn channel_for_requests(sender: Sender<AgentRequest>) -> Channel<AgentRequest> {
        Channel::new(move |body| {
            let request: AgentRequest = body.deserialize().expect("channel request should be JSON");
            sender
                .send(request)
                .expect("request receiver should be alive");
            Ok(())
        })
    }

    #[test]
    fn accepts_tool_and_discovery_posts() {
        assert_eq!(guard(&head("POST", "/api/v1/create_card"), 8787), Ok(()));
        assert_eq!(guard(&head("POST", HEALTH_ENDPOINT), 8787), Ok(()));
        assert_eq!(guard(&head("POST", TOOLS_ENDPOINT), 8787), Ok(()));
        assert_eq!(guard(&head("POST", SKILL_ENDPOINT), 8787), Ok(()));
    }

    #[test]
    fn refuses_get_so_markup_cannot_probe_the_port() {
        assert_eq!(
            guard(&head("GET", "/api/v1/create_card"), 8787)
                .unwrap_err()
                .status,
            405
        );
        assert_eq!(
            guard(&head("GET", HEALTH_ENDPOINT), 8787)
                .unwrap_err()
                .status,
            405
        );
        assert_eq!(
            guard(&head("GET", SKILL_ENDPOINT), 8787)
                .unwrap_err()
                .status,
            405
        );
    }

    #[test]
    fn embeds_the_canonical_skill_and_computes_a_stable_etag() {
        assert!(SKILL_MARKDOWN.starts_with("---\n") || SKILL_MARKDOWN.starts_with("---\r\n"));
        assert!(SKILL_MARKDOWN.contains("name: contextboard"));
        assert_eq!(skill_etag(), skill_etag());
        assert_eq!(skill_etag().len(), 66);
    }

    #[test]
    fn rejects_paths_origins_missing_content_types_and_non_loopback_hosts() {
        assert_eq!(
            guard(&head("POST", "/wrong"), 8787).unwrap_err().status,
            404
        );
        let mut request = head("POST", "/api/v1/create_card");
        request.content_type = None;
        assert_eq!(guard(&request, 8787).unwrap_err().status, 415);
        let mut request = head("POST", "/api/v1/create_card");
        request.origin = Some("https://example.com");
        assert_eq!(guard(&request, 8787).unwrap_err().status, 403);
        let mut request = head("POST", "/api/v1/create_card");
        request.host = Some("agent.example.test:8787");
        assert_eq!(guard(&request, 8787).unwrap_err().status, 403);
    }

    #[test]
    fn accepts_loopback_hosts_and_query_strings() {
        for host in ["localhost:8787", "[::1]:8787", "::1:8787"] {
            let mut request = head("POST", "/api/v1/create_card?trace=1");
            request.host = Some(host);
            assert_eq!(guard(&request, 8787), Ok(()), "host {host} should pass");
        }
    }

    #[test]
    fn is_disabled_until_the_user_turns_it_on() {
        let directory = tempfile::tempdir().expect("temp dir");
        let storage = Storage::open(directory.path()).expect("storage");
        assert!(!is_enabled(&storage).expect("read setting"));
    }

    #[test]
    fn settings_fail_closed_and_port_falls_back_safely() {
        let directory = tempfile::tempdir().expect("temp dir");
        let storage = Storage::open(directory.path()).expect("storage");
        for value in ["yes", "1", "TRUE", "maybe"] {
            storage
                .set_setting(ENABLED_SETTING_KEY, value)
                .expect("set setting");
            assert!(!is_enabled(&storage).expect("read setting"));
        }
        storage
            .set_setting(ENABLED_SETTING_KEY, "true")
            .expect("set setting");
        assert!(is_enabled(&storage).expect("read setting"));
        assert_eq!(configured_port(&storage).expect("port"), DEFAULT_PORT);
        storage
            .set_setting(PORT_SETTING_KEY, "9911")
            .expect("set setting");
        assert_eq!(configured_port(&storage).expect("port"), 9911);
    }

    #[test]
    fn health_workspace_resolution_defaults_and_follows_the_setting() {
        let directory = tempfile::tempdir().expect("temp dir");
        let storage = Storage::open(directory.path()).expect("storage");
        assert_eq!(
            active_workspace(&storage).expect("workspace"),
            DEFAULT_WORKSPACE_ID
        );
        storage
            .set_setting(WORKSPACE_SETTING_KEY, "workspace-from-server")
            .expect("set workspace");
        assert_eq!(
            active_workspace(&storage).expect("workspace"),
            "workspace-from-server"
        );
    }

    #[test]
    fn no_subscriber_fails_fast() {
        let state = AgentState::default();
        let error = state
            .call("echo", json!({}), Duration::from_millis(10))
            .expect_err("renderer should be unavailable");
        assert_eq!(error.code, "RENDERER_UNAVAILABLE");
        assert_eq!(error.status, 503);
    }

    #[test]
    fn subscribe_then_reply_resolves_the_pending_call() {
        let state = Arc::new(AgentState::default());
        let (requests, received) = mpsc::channel();
        let generation = state.subscribe(channel_for_requests(requests), vec!["echo".into()]);
        let caller_state = Arc::clone(&state);
        let caller = thread::spawn(move || {
            caller_state.call("echo", json!({"value": 1}), Duration::from_secs(1))
        });
        let request = received.recv().expect("renderer request");
        assert!(state.respond(
            generation,
            request.id,
            true,
            Some(json!({"ok": true})),
            None
        ));
        assert_eq!(
            caller.join().expect("caller thread").expect("reply"),
            json!({"ok": true})
        );
    }

    #[test]
    fn stale_generation_is_ignored_until_the_current_reply_arrives() {
        let state = Arc::new(AgentState::default());
        let (requests, received) = mpsc::channel();
        let generation = state.subscribe(channel_for_requests(requests), vec!["echo".into()]);
        let caller_state = Arc::clone(&state);
        let caller =
            thread::spawn(move || caller_state.call("echo", json!({}), Duration::from_secs(1)));
        let request = received.recv().expect("renderer request");
        assert!(!state.respond(generation + 1, request.id, true, Some(json!("stale")), None));
        assert_eq!(state.pending_count(), 1);
        assert!(state.respond(generation, request.id, true, Some(json!("current")), None));
        assert_eq!(
            caller.join().expect("caller thread").expect("reply"),
            json!("current")
        );
    }

    #[test]
    fn resubscribe_fails_all_pending_calls_with_renderer_reset() {
        let state = Arc::new(AgentState::default());
        let (requests, received) = mpsc::channel();
        let first_generation = state.subscribe(channel_for_requests(requests), vec!["echo".into()]);
        let caller_state = Arc::clone(&state);
        let caller =
            thread::spawn(move || caller_state.call("echo", json!({}), Duration::from_secs(1)));
        let request = received.recv().expect("renderer request");
        let (next_requests, _next_received) = mpsc::channel();
        let next_generation =
            state.subscribe(channel_for_requests(next_requests), vec!["echo".into()]);
        let error = caller
            .join()
            .expect("caller thread")
            .expect_err("reset should fail the call");
        assert_eq!(error.code, "RENDERER_RESET");
        assert_eq!(state.pending_count(), 0);
        assert!(!state.respond(
            first_generation,
            request.id,
            true,
            Some(json!("late")),
            None
        ));
        assert!(next_generation > first_generation);
    }

    #[test]
    fn timeout_returns_renderer_timeout_and_cleans_pending() {
        let state = AgentState::default();
        let (requests, _received) = mpsc::channel();
        state.subscribe(channel_for_requests(requests), vec!["echo".into()]);
        let error = state
            .call("echo", json!({}), Duration::from_millis(10))
            .expect_err("call should time out");
        assert_eq!(error.code, "RENDERER_TIMEOUT");
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn concurrent_calls_can_reply_out_of_order() {
        let state = Arc::new(AgentState::default());
        let (requests, received) = mpsc::channel();
        let generation = state.subscribe(channel_for_requests(requests), vec!["echo".into()]);
        let first_state = Arc::clone(&state);
        let second_state = Arc::clone(&state);
        let first = thread::spawn(move || {
            first_state.call("echo", json!({"call": 1}), Duration::from_secs(1))
        });
        let second = thread::spawn(move || {
            second_state.call("echo", json!({"call": 2}), Duration::from_secs(1))
        });
        let first_request = received.recv().expect("first renderer request");
        let second_request = received.recv().expect("second renderer request");
        assert!(state.respond(generation, second_request.id, true, Some(json!(2)), None));
        assert!(state.respond(generation, first_request.id, true, Some(json!(1)), None));
        assert_eq!(first.join().expect("first call").expect("reply"), json!(1));
        assert_eq!(
            second.join().expect("second call").expect("reply"),
            json!(2)
        );
    }
}
