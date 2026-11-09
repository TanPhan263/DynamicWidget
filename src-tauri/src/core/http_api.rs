//! Local HTTP API for sending notifications from scripts and tools:
//!
//! ```sh
//! curl -X POST http://127.0.0.1:47821/v1/notify \
//!   -H 'Content-Type: application/json' \
//!   -d '{"title":"Build passed","body":"main · 2m 14s","app":"CI","icon":"✅"}'
//! ```
//!
//! The server binds the loopback interface only. Web pages cannot use it:
//! requests carrying a web page's `Origin` header (which browsers add to
//! cross-site and POST requests) are refused, a JSON content type is
//! required (which a page cannot send cross-origin without a CORS preflight
//! that is never answered), and the `Host` header must name the loopback
//! address, which defeats DNS rebinding.
//!
//! The Islet browser extension forwards website notifications. Its requests
//! come from an extension origin and must carry the pairing token shown in
//! Settings (`Authorization: Bearer <token>`); see [`super::pairing`].

use std::io::Read;
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use serde::Serialize;
use serde_json::json;
use tiny_http::{Header, Response, Server};

use super::media::MediaInput;
use super::notifications::{Notification, NotificationInput, NotificationSource};
use super::pairing;
use crate::errors::{AppError, AppResult};

pub const MAX_BODY_BYTES: usize = 16 * 1024;

pub type Sink =
    Arc<dyn Fn(NotificationInput, NotificationSource) -> AppResult<Notification> + Send + Sync>;
/// Takes what the browser is playing.
pub type MediaSink = Arc<dyn Fn(MediaInput) -> AppResult<()> + Send + Sync>;
/// Reads the current pairing token, so a new token applies without a restart.
pub type TokenSource = Arc<dyn Fn() -> String + Send + Sync>;

/// Origins of browser extensions. Web pages cannot claim these.
const EXTENSION_ORIGINS: [&str; 3] = [
    "chrome-extension://",
    "moz-extension://",
    "safari-web-extension://",
];

#[derive(Debug, PartialEq)]
pub enum Route {
    /// `paired` is true when the request carried the right token.
    Health {
        paired: bool,
    },
    Notify(NotificationInput, NotificationSource),
    /// What a website plays; only the paired extension sends this.
    Media(MediaInput),
}

#[derive(Debug, PartialEq)]
pub struct Rejection {
    pub status: u16,
    pub message: String,
}

fn reject(status: u16, message: impl Into<String>) -> Rejection {
    Rejection {
        status,
        message: message.into(),
    }
}

/// The parts of a request the router looks at, so routing can be tested
/// without sockets.
pub struct ApiRequest<'a> {
    pub method: &'a str,
    pub url: &'a str,
    pub host: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub authorization: Option<&'a str>,
    pub content_type: Option<&'a str>,
    pub body: &'a [u8],
}

fn host_is_loopback(host: &str, port: u16) -> bool {
    ["127.0.0.1", "localhost"].iter().any(|name| {
        host.eq_ignore_ascii_case(name) || host.eq_ignore_ascii_case(&format!("{name}:{port}"))
    })
}

fn is_extension(origin: &str) -> bool {
    let origin = origin.trim().to_ascii_lowercase();
    EXTENSION_ORIGINS.iter().any(|s| origin.starts_with(s))
}

pub fn route(req: &ApiRequest, port: u16, token: &str) -> Result<Route, Rejection> {
    if req.origin.is_some_and(|o| !is_extension(o)) {
        return Err(reject(403, "Browser requests are not accepted"));
    }
    if !req.host.is_some_and(|h| host_is_loopback(h.trim(), port)) {
        return Err(reject(403, "Use http://127.0.0.1 to reach the Islet API"));
    }
    // Scripts send neither header. The extension must always send the token.
    let given = req
        .authorization
        .map(|a| a.trim().strip_prefix("Bearer ").unwrap_or("").trim());
    let source = match given {
        Some(t) if pairing::matches(t, token) => NotificationSource::Browser,
        None if req.origin.is_none() => NotificationSource::Api,
        _ => {
            return Err(reject(
                401,
                "Not paired. Copy the token from Islet Settings → Browser into the extension",
            ))
        }
    };
    let path = req.url.split(['?', '#']).next().unwrap_or("");
    match (req.method, path) {
        ("GET", "/v1/health") => Ok(Route::Health {
            paired: source == NotificationSource::Browser,
        }),
        ("POST", "/v1/notify" | "/v1/media") => {
            let json = req.content_type.is_some_and(|c| {
                c.trim()
                    .to_ascii_lowercase()
                    .starts_with("application/json")
            });
            if !json {
                return Err(reject(
                    415,
                    "Send the notification as JSON (Content-Type: application/json)",
                ));
            }
            if req.body.len() > MAX_BODY_BYTES {
                return Err(reject(
                    413,
                    format!("Body is larger than {MAX_BODY_BYTES} bytes"),
                ));
            }
            if path == "/v1/media" {
                if source != NotificationSource::Browser {
                    return Err(reject(
                        401,
                        "Only the paired browser extension reports media",
                    ));
                }
                return serde_json::from_slice::<MediaInput>(req.body)
                    .map(Route::Media)
                    .map_err(|e| reject(400, format!("Invalid media: {e}")));
            }
            serde_json::from_slice::<NotificationInput>(req.body)
                .map(|input| Route::Notify(input, source))
                .map_err(|e| reject(400, format!("Invalid notification: {e}")))
        }
        (_, "/v1/health" | "/v1/notify" | "/v1/media") => Err(reject(405, "Method not allowed")),
        _ => Err(reject(404, "Not found. Use POST /v1/notify")),
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    pub running: bool,
    pub url: Option<String>,
    pub error: Option<String>,
}

struct Running {
    server: Arc<Server>,
    port: u16,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct ApiServer {
    running: Option<Running>,
    error: Option<String>,
}

impl ApiServer {
    /// Starts, stops or moves the server to match the settings.
    pub fn apply(
        &mut self,
        enabled: bool,
        port: u16,
        sink: Sink,
        media: MediaSink,
        token: TokenSource,
    ) -> AppResult<()> {
        if enabled && self.running.as_ref().is_some_and(|r| r.port == port) {
            return Ok(());
        }
        self.stop();
        self.error = None;
        if !enabled {
            return Ok(());
        }
        let server = match Server::http(("127.0.0.1", port)) {
            Ok(s) => Arc::new(s),
            Err(e) => {
                let message =
                    format!("Port {port} is unavailable ({e}). Choose another port in Settings.");
                self.error = Some(message.clone());
                return Err(AppError::Api(message));
            }
        };
        let worker = server.clone();
        let thread = thread::Builder::new()
            .name("islet-api".into())
            .spawn(move || serve(&worker, port, &sink, &media, &token))
            .map_err(|e| AppError::Api(e.to_string()))?;
        log::info!("notification API listening on 127.0.0.1:{port}");
        self.running = Some(Running {
            server,
            port,
            thread,
        });
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(r) = self.running.take() {
            r.server.unblock();
            let _ = r.thread.join();
            log::info!("notification API stopped");
        }
    }

    pub fn status(&self) -> ApiStatus {
        ApiStatus {
            running: self.running.is_some(),
            url: self
                .running
                .as_ref()
                .map(|r| format!("http://127.0.0.1:{}", r.port)),
            error: self.error.clone(),
        }
    }
}

fn header<'a>(headers: &'a [Header], name: &'static str) -> Option<&'a str> {
    headers
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

fn reply(status: u16, body: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let content_type =
        Header::from_bytes("Content-Type", "application/json").expect("static header is valid");
    Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(content_type)
}

fn serve(server: &Server, port: u16, sink: &Sink, media: &MediaSink, token: &TokenSource) {
    // `incoming_requests` ends when `unblock` is called.
    for mut request in server.incoming_requests() {
        let too_big = request.body_length().is_some_and(|n| n > MAX_BODY_BYTES);
        let mut body = Vec::new();
        if !too_big {
            let _ = request
                .as_reader()
                .take(MAX_BODY_BYTES as u64 + 1)
                .read_to_end(&mut body);
        }
        let method = request.method().as_str().to_string();
        let url = request.url().to_string();
        let headers = request.headers();
        let parsed = if too_big {
            Err(reject(
                413,
                format!("Body is larger than {MAX_BODY_BYTES} bytes"),
            ))
        } else {
            route(
                &ApiRequest {
                    method: &method,
                    url: &url,
                    host: header(headers, "Host"),
                    origin: header(headers, "Origin"),
                    authorization: header(headers, "Authorization"),
                    content_type: header(headers, "Content-Type"),
                    body: &body,
                },
                port,
                &token(),
            )
        };
        let response = match parsed {
            Ok(Route::Health { paired }) => reply(
                200,
                json!({ "ok": true, "app": "islet", "version": env!("CARGO_PKG_VERSION"), "paired": paired }),
            ),
            Ok(Route::Notify(input, source)) => match sink(input, source) {
                Ok(n) => reply(201, json!({ "ok": true, "id": n.id })),
                Err(e) => reply(400, json!({ "ok": false, "error": e.to_string() })),
            },
            Ok(Route::Media(input)) => match media(input) {
                Ok(()) => reply(200, json!({ "ok": true })),
                Err(e) => reply(400, json!({ "ok": false, "error": e.to_string() })),
            },
            Err(r) => reply(r.status, json!({ "ok": false, "error": r.message })),
        };
        if let Err(e) = request.respond(response) {
            log::debug!("api response failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 47821;
    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn req<'a>(method: &'a str, url: &'a str, body: &'a [u8]) -> ApiRequest<'a> {
        ApiRequest {
            method,
            url,
            host: Some("127.0.0.1:47821"),
            origin: None,
            authorization: None,
            content_type: Some("application/json; charset=utf-8"),
            body,
        }
    }

    #[test]
    fn notify_parses_json() {
        let r = route(
            &req("POST", "/v1/notify", br#"{"title":"Hi","body":"there"}"#),
            PORT,
            TOKEN,
        )
        .unwrap();
        let Route::Notify(input, source) = r else {
            panic!("expected notify")
        };
        assert_eq!(input.title, "Hi");
        assert_eq!(input.body.as_deref(), Some("there"));
        assert_eq!(source, NotificationSource::Api);
    }

    #[test]
    fn the_paired_extension_is_accepted() {
        let auth = format!("Bearer {TOKEN}");
        let r = ApiRequest {
            origin: Some("chrome-extension://abcdefghijklmnop"),
            authorization: Some(&auth),
            ..req("POST", "/v1/notify", br#"{"title":"New mail"}"#)
        };
        let Ok(Route::Notify(_, source)) = route(&r, PORT, TOKEN) else {
            panic!("expected notify")
        };
        assert_eq!(source, NotificationSource::Browser);
        let health = ApiRequest {
            origin: Some("moz-extension://1234"),
            authorization: Some(&auth),
            ..req("GET", "/v1/health", b"")
        };
        assert_eq!(
            route(&health, PORT, TOKEN),
            Ok(Route::Health { paired: true })
        );
    }

    #[test]
    fn only_the_extension_reports_media() {
        let body = br#"{"title":"Song","playing":true}"#;
        assert_eq!(
            route(&req("POST", "/v1/media", body), PORT, TOKEN)
                .unwrap_err()
                .status,
            401
        );
        let auth = format!("Bearer {TOKEN}");
        let r = ApiRequest {
            origin: Some("chrome-extension://abc"),
            authorization: Some(&auth),
            ..req("POST", "/v1/media", body)
        };
        let Ok(Route::Media(input)) = route(&r, PORT, TOKEN) else {
            panic!("expected media")
        };
        assert_eq!(input.title, "Song");
        assert!(input.playing);
    }

    #[test]
    fn extensions_need_the_token() {
        let ext = |authorization| ApiRequest {
            origin: Some("chrome-extension://abcdefghijklmnop"),
            authorization,
            ..req("POST", "/v1/notify", br#"{"title":"x"}"#)
        };
        assert_eq!(route(&ext(None), PORT, TOKEN).unwrap_err().status, 401);
        assert_eq!(
            route(&ext(Some("Bearer nope")), PORT, TOKEN)
                .unwrap_err()
                .status,
            401
        );
        assert_eq!(
            route(&ext(Some(TOKEN)), PORT, TOKEN).unwrap_err().status,
            401
        );
        // Before pairing there is no token, and nothing matches it.
        let auth = format!("Bearer {TOKEN}");
        assert_eq!(route(&ext(Some(&auth)), PORT, "").unwrap_err().status, 401);
        // A web page cannot borrow the token either.
        let page = ApiRequest {
            origin: Some("https://evil.example"),
            authorization: Some(&auth),
            ..req("POST", "/v1/notify", br#"{"title":"x"}"#)
        };
        assert_eq!(route(&page, PORT, TOKEN).unwrap_err().status, 403);
    }

    #[test]
    fn health_ignores_query() {
        assert_eq!(
            route(&req("GET", "/v1/health?x=1", b""), PORT, TOKEN),
            Ok(Route::Health { paired: false })
        );
    }

    #[test]
    fn browser_requests_are_refused() {
        let r = ApiRequest {
            origin: Some("https://evil.example"),
            ..req("POST", "/v1/notify", br#"{"title":"x"}"#)
        };
        assert_eq!(route(&r, PORT, TOKEN).unwrap_err().status, 403);
    }

    #[test]
    fn rebinding_hosts_are_refused() {
        let r = ApiRequest {
            host: Some("evil.example:47821"),
            ..req("GET", "/v1/health", b"")
        };
        assert_eq!(route(&r, PORT, TOKEN).unwrap_err().status, 403);
        let r = ApiRequest {
            host: None,
            ..req("GET", "/v1/health", b"")
        };
        assert_eq!(route(&r, PORT, TOKEN).unwrap_err().status, 403);
        let r = ApiRequest {
            host: Some("localhost:47821"),
            ..req("GET", "/v1/health", b"")
        };
        assert_eq!(route(&r, PORT, TOKEN), Ok(Route::Health { paired: false }));
    }

    #[test]
    fn notify_requires_json_content_type() {
        let r = ApiRequest {
            content_type: Some("text/plain"),
            ..req("POST", "/v1/notify", br#"{"title":"x"}"#)
        };
        assert_eq!(route(&r, PORT, TOKEN).unwrap_err().status, 415);
    }

    #[test]
    fn bad_bodies_and_routes() {
        assert_eq!(
            route(&req("POST", "/v1/notify", b"nope"), PORT, TOKEN)
                .unwrap_err()
                .status,
            400
        );
        assert_eq!(
            route(
                &req("POST", "/v1/notify", br#"{"title":"x","extra":1}"#),
                PORT,
                TOKEN
            )
            .unwrap_err()
            .status,
            400
        );
        let big = vec![b' '; MAX_BODY_BYTES + 1];
        assert_eq!(
            route(&req("POST", "/v1/notify", &big), PORT, TOKEN)
                .unwrap_err()
                .status,
            413
        );
        assert_eq!(
            route(&req("GET", "/v1/notify", b""), PORT, TOKEN)
                .unwrap_err()
                .status,
            405
        );
        assert_eq!(
            route(&req("GET", "/", b""), PORT, TOKEN)
                .unwrap_err()
                .status,
            404
        );
    }
}
