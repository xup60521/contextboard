//! Desktop sign-in handoff.
//!
//! The desktop shell has no cookie jar it can share with the sync server, so it
//! authenticates with a Better Auth bearer token instead. Getting that token is
//! a loopback redirect: we bind an ephemeral `127.0.0.1` listener, open the
//! user's real browser at the web app's `/desktop-auth` page, and wait for that
//! page to redirect back with a single-use token. The renderer only ever sees
//! the one-time token; the long-lived session token is stored in the OS keyring
//! and never crosses the IPC boundary in the clear more than once.

use serde::Serialize;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    sync::Mutex,
    time::{Duration, Instant},
};

const KEYRING_SERVICE: &str = "app.contextboard.desktop";
const KEYRING_ACCOUNT: &str = "sync-session";
/// Matches the server's `oneTimeToken({ expiresIn: 3 })` window.
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(180);
const ACCEPT_POLL: Duration = Duration::from_millis(100);
const MAX_TOKEN_LENGTH: usize = 512;
const MAX_REQUEST_LINE: u64 = 8 * 1024;

#[derive(Debug)]
pub enum AuthError {
    Invalid(String),
    TimedOut,
    Provider(String),
    Io(std::io::Error),
}

impl From<std::io::Error> for AuthError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<keyring::Error> for AuthError {
    fn from(value: keyring::Error) -> Self {
        Self::Provider(format!("Secure storage failed: {value}"))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthHandoff {
    pub redirect_uri: String,
    pub authorize_url: String,
}

/// Holds the listener between `desktop_auth_start` and `desktop_auth_wait` so a
/// cancelled sign-in releases the port instead of leaking it.
#[derive(Default)]
pub struct AuthHandoffState {
    listener: Mutex<Option<TcpListener>>,
}

impl AuthHandoffState {
    pub fn start(&self, base_url: &str) -> Result<AuthHandoff, AuthError> {
        let base = normalize_base_url(base_url)?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}/callback");
        *self.listener.lock().expect("auth mutex poisoned") = Some(listener);
        Ok(AuthHandoff {
            authorize_url: format!(
                "{base}/desktop-auth?redirect={}",
                encode_component(&redirect_uri)
            ),
            redirect_uri,
        })
    }

    pub fn take(&self) -> Option<TcpListener> {
        self.listener.lock().expect("auth mutex poisoned").take()
    }

    pub fn cancel(&self) {
        drop(self.take());
    }
}

/// Blocks on the loopback listener until the browser redirect arrives. Runs on a
/// blocking worker, never the UI thread.
pub fn wait_for_token(listener: TcpListener) -> Result<String, AuthError> {
    let deadline = Instant::now() + HANDOFF_TIMEOUT;
    loop {
        if Instant::now() >= deadline {
            return Err(AuthError::TimedOut);
        }
        match listener.accept() {
            Ok((stream, _)) => match handle_connection(stream) {
                // Anything that is not our callback (a favicon probe, say) leaves
                // the listener open for the real redirect.
                Ok(None) => continue,
                Ok(Some(token)) => return Ok(token),
                Err(error) => return Err(error),
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_POLL);
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn handle_connection(stream: TcpStream) -> Result<Option<String>, AuthError> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader
        .by_ref()
        .take(MAX_REQUEST_LINE)
        .read_line(&mut request_line)?;
    let outcome = parse_callback(&request_line);
    let mut stream = stream;
    match &outcome {
        Ok(None) => write_response(
            &mut stream,
            "404 Not Found",
            ResponseKind::Error,
            "Page not found",
            "Not found.",
        )?,
        Ok(Some(_)) => write_response(
            &mut stream,
            "200 OK",
            ResponseKind::Success,
            "Signed in",
            "You can close this tab and return to Contextboard.",
        )?,
        Err(AuthError::Provider(message)) => write_response(
            &mut stream,
            "400 Bad Request",
            ResponseKind::Error,
            "Sign in failed",
            message,
        )?,
        Err(_) => write_response(
            &mut stream,
            "400 Bad Request",
            ResponseKind::Error,
            "Sign in failed",
            "Sign in failed.",
        )?,
    }
    outcome
}

enum ResponseKind {
    Success,
    Error,
}

/// `GET /callback?token=… HTTP/1.1` → the token, or a provider error the web
/// page forwarded. Any other path yields `None`.
fn parse_callback(request_line: &str) -> Result<Option<String>, AuthError> {
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Ok(None);
    }
    let Some(target) = parts.next() else {
        return Ok(None);
    };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return Ok(None);
    }
    let mut token = None;
    let mut error = None;
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("token", value)) => token = Some(decode_component(value)),
            Some(("error", value)) => error = Some(decode_component(value)),
            _ => {}
        }
    }
    if let Some(error) = error {
        return Err(AuthError::Provider(sanitize_message(&error)));
    }
    let token =
        token.ok_or_else(|| AuthError::Invalid("The sign-in response had no token".into()))?;
    validate_token(&token)?;
    Ok(Some(token))
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    kind: ResponseKind,
    title: &str,
    message: &str,
) -> Result<(), AuthError> {
    let (icon_class, icon_svg) = match kind {
        ResponseKind::Success => (
            "success",
            r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 13 10 18 19 7"/></svg>"#,
        ),
        ResponseKind::Error => (
            "error",
            r#"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>"#,
        ),
    };
    let body = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Contextboard</title><style>
:root{{color-scheme:light dark}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px}}
.card{{max-width:360px;width:100%;text-align:center;background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:16px;padding:32px 28px;box-shadow:0 1px 2px rgba(0,0,0,.04)}}
.icon{{width:48px;height:48px;margin:0 auto 16px;border-radius:999px;display:flex;align-items:center;justify-content:center}}
.icon svg{{width:24px;height:24px}}
.icon.success{{background:rgba(16,185,129,.12);color:#10b981}}
.icon.error{{background:rgba(239,68,68,.12);color:#ef4444}}
h1{{margin:0 0 8px;font-size:20px;font-weight:700;color:#1f2024}}
p{{margin:0;font-size:15px;line-height:1.5;color:#6b7280}}
@media (prefers-color-scheme:dark){{
body{{background:#0b0b0d}}
.card{{background:#18181b;border-color:rgba(255,255,255,.1)}}
h1{{color:#f4f4f5}}
p{{color:#a1a1aa}}
}}
</style></head><body><div class="card"><div class="icon {icon_class}">{icon_svg}</div><h1>{}</h1><p>{}</p></div></body></html>"#,
        escape_html(title),
        escape_html(message)
    );
    write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\ncache-control: no-store\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()?;
    Ok(())
}

pub fn store_token(token: &str) -> Result<(), AuthError> {
    validate_token(token)?;
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?.set_password(token)?;
    Ok(())
}

pub fn read_token() -> Result<Option<String>, AuthError> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn clear_token() -> Result<(), AuthError> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Only absolute http/https origins are accepted, so a compromised renderer
/// cannot point the browser at an arbitrary scheme.
fn normalize_base_url(value: &str) -> Result<String, AuthError> {
    let trimmed = value.trim().trim_end_matches('/');
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| AuthError::Invalid("The sign-in URL must be http or https".into()))?;
    let host = rest.split('/').next().unwrap_or("");
    let valid_host = !host.is_empty()
        && host.len() <= 255
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c));
    if !valid_host || rest.contains(['?', '#', ' ', '\r', '\n', '\\']) {
        return Err(AuthError::Invalid("The sign-in URL is invalid".into()));
    }
    Ok(trimmed.to_owned())
}

fn validate_token(token: &str) -> Result<(), AuthError> {
    if token.is_empty()
        || token.len() > MAX_TOKEN_LENGTH
        || !token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~+/=".contains(c))
    {
        return Err(AuthError::Invalid("The sign-in token is invalid".into()));
    }
    Ok(())
}

fn sanitize_message(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect()
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn decode_component(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                match u8::from_str_radix(&value[index + 1..index + 3], 16) {
                    Ok(byte) => {
                        out.push(byte);
                        index += 3;
                    }
                    Err(_) => {
                        out.push(b'%');
                        index += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_is_parsed_only_for_the_expected_path() {
        assert_eq!(
            parse_callback("GET /callback?token=abc.def-123 HTTP/1.1\r\n").unwrap(),
            Some("abc.def-123".into())
        );
        assert_eq!(
            parse_callback("GET /favicon.ico HTTP/1.1\r\n").unwrap(),
            None
        );
        assert_eq!(parse_callback("POST /callback HTTP/1.1\r\n").unwrap(), None);
        assert!(matches!(
            parse_callback("GET /callback HTTP/1.1\r\n"),
            Err(AuthError::Invalid(_))
        ));
        assert!(matches!(
            parse_callback("GET /callback?token=%3Cscript%3E HTTP/1.1\r\n"),
            Err(AuthError::Invalid(_))
        ));
        let forwarded = parse_callback("GET /callback?error=access%20denied HTTP/1.1\r\n");
        assert!(
            matches!(forwarded, Err(AuthError::Provider(ref message)) if message == "access denied")
        );
    }

    #[test]
    fn base_url_must_be_an_http_origin() {
        assert_eq!(
            normalize_base_url("https://contextboard.app/").unwrap(),
            "https://contextboard.app"
        );
        assert!(normalize_base_url("javascript:alert(1)").is_err());
        assert!(normalize_base_url("file:///c:/windows").is_err());
        assert!(normalize_base_url("http://").is_err());
        assert!(normalize_base_url("http://host/x?y=1").is_err());
    }

    #[test]
    fn start_binds_a_loopback_port_and_builds_the_authorize_url() {
        let state = AuthHandoffState::default();
        let handoff = state.start("http://localhost:3000").unwrap();
        assert!(handoff.redirect_uri.starts_with("http://127.0.0.1:"));
        assert!(handoff
            .authorize_url
            .starts_with("http://localhost:3000/desktop-auth?redirect=http%3A%2F%2F127.0.0.1%3A"));
        assert!(state.take().is_some());
        assert!(state.take().is_none());
    }
}
