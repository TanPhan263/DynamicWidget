//! Stock and crypto quotes for the Stocks widget and the island, from
//! Yahoo Finance's public data (no account or key needed).
//!
//! Two background threads work while the widget is shown or a symbol is
//! pinned to the island:
//! - the streamer holds a WebSocket to Yahoo's price stream, which pushes
//!   each new price as it trades;
//! - the poller loads the chart endpoint for names, currencies, the previous
//!   close and today's sparkline, every few minutes (every minute while the
//!   stream is down, so prices still move).

use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use super::notifications::now_ms;
use super::settings_service::{Settings, WidgetId};
use crate::actions;

/// Most symbols a person can follow.
pub const MAX_SYMBOLS: usize = 8;
/// Most symbols the closed island takes turns showing.
pub const MAX_ISLAND_STOCKS: usize = 3;
pub const QUOTES_CHANGED: &str = "quotes-changed";
/// Chart refresh while the stream supplies prices, and while it does not.
const REFRESH_STREAMING: Duration = Duration::from_secs(300);
const REFRESH: Duration = Duration::from_secs(60);
/// After a failed round, try again sooner.
const RETRY: Duration = Duration::from_secs(20);
const STREAM_URL: &str = "wss://streamer.finance.yahoo.com/?version=2";
/// Ticks are batched into one update for the pages this often.
const EMIT_EVERY: Duration = Duration::from_millis(300);
/// A ping this often notices a connection that died quietly.
const PING_EVERY: Duration = Duration::from_secs(30);
/// A streamed price this recent wins over the chart's, which lags.
const STREAM_FRESH: Duration = Duration::from_secs(300);
const TICK: Duration = Duration::from_millis(500);
/// Enough points for a smooth sparkline.
const MAX_POINTS: usize = 60;
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Islet";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub previous_close: f64,
    pub change: f64,
    pub change_percent: f64,
    pub currency: String,
    /// Today's prices, oldest first, for a sparkline.
    pub points: Vec<f64>,
    /// Unix time in milliseconds.
    pub updated_at: u64,
}

/// The latest result for one symbol; a failed refresh keeps the last quote.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteState {
    pub symbol: String,
    pub quote: Option<Quote>,
    pub error: Option<String>,
    /// When the stream last moved the price.
    #[serde(skip)]
    pub streamed_at: Option<Instant>,
}

impl QuoteState {
    pub fn empty(symbol: String) -> Self {
        Self {
            symbol,
            quote: None,
            error: None,
            streamed_at: None,
        }
    }

    /// Takes a chart result, keeping a fresher streamed price so the price
    /// never jumps back to the chart's older one.
    fn merge_chart(&mut self, result: Result<Quote, String>) {
        match result {
            Ok(mut q) => {
                let fresh = self.streamed_at.is_some_and(|t| t.elapsed() < STREAM_FRESH);
                if let (true, Some(old)) = (fresh, &self.quote) {
                    set_price(&mut q, old.price, old.updated_at);
                }
                self.quote = Some(q);
                self.error = None;
            }
            Err(e) => self.error = Some(e),
        }
    }

    fn apply_tick(&mut self, tick: &Tick, now_ms: u64) {
        let q = self.quote.get_or_insert_with(|| Quote {
            symbol: tick.symbol.clone(),
            name: tick.symbol.clone(),
            price: tick.price,
            previous_close: 0.0,
            change: 0.0,
            change_percent: 0.0,
            currency: String::new(),
            points: Vec::new(),
            updated_at: now_ms,
        });
        if let Some(pc) = tick.previous_close.filter(|p| p.is_finite() && *p > 0.0) {
            q.previous_close = pc;
        }
        set_price(q, tick.price, now_ms);
        self.streamed_at = Some(Instant::now());
    }
}

/// Moves a quote to a new price; the sparkline ends at it.
fn set_price(q: &mut Quote, price: f64, at_ms: u64) {
    q.price = price;
    if q.previous_close <= 0.0 {
        q.previous_close = price;
    }
    q.change = price - q.previous_close;
    q.change_percent = q.change / q.previous_close * 100.0;
    if let Some(last) = q.points.last_mut() {
        *last = price;
    }
    q.updated_at = at_ms;
}

/// One price from the stream.
#[derive(Debug, PartialEq)]
pub struct Tick {
    pub symbol: String,
    pub price: f64,
    pub previous_close: Option<f64>,
}

/// Reads a stream message: JSON whose `message` is a base64 protobuf
/// `PricingData`. Only symbol (1), price (2) and previous close (15) are
/// used; other fields are skipped by wire type.
pub fn decode_tick(text: &str) -> Option<Tick> {
    #[derive(Deserialize)]
    struct Envelope {
        message: String,
    }
    let env: Envelope = serde_json::from_str(text).ok()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(env.message)
        .ok()?;
    let mut r = Proto {
        buf: &bytes,
        pos: 0,
    };
    let (mut symbol, mut price, mut previous_close) = (None, None, None);
    while r.pos < r.buf.len() {
        let key = r.varint()?;
        match (key >> 3, key & 7) {
            (1, 2) => symbol = Some(String::from_utf8(r.bytes()?.to_vec()).ok()?),
            (2, 5) => price = Some(r.float()?),
            (15, 5) => previous_close = Some(r.float()?),
            (_, 0) => {
                r.varint()?;
            }
            (_, 1) => r.skip(8)?,
            (_, 2) => {
                r.bytes()?;
            }
            (_, 5) => r.skip(4)?,
            _ => return None,
        }
    }
    let price = price.filter(|p| p.is_finite() && *p > 0.0)?;
    Some(Tick {
        symbol: normalize_symbol(&symbol?)?,
        price,
        previous_close,
    })
}

/// Just enough protobuf to read `PricingData`.
struct Proto<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl Proto<'_> {
    fn varint(&mut self) -> Option<u64> {
        let mut out = 0u64;
        for shift in (0..64).step_by(7) {
            let b = *self.buf.get(self.pos)?;
            self.pos += 1;
            out |= u64::from(b & 0x7f) << shift;
            if b < 0x80 {
                return Some(out);
            }
        }
        None
    }

    fn skip(&mut self, n: usize) -> Option<()> {
        (self.pos + n <= self.buf.len()).then(|| self.pos += n)
    }

    fn bytes(&mut self) -> Option<&[u8]> {
        let len = usize::try_from(self.varint()?).ok()?;
        let start = self.pos;
        self.skip(len)?;
        Some(&self.buf[start..start + len])
    }

    fn float(&mut self) -> Option<f64> {
        let raw: [u8; 4] = self.buf.get(self.pos..self.pos + 4)?.try_into().ok()?;
        self.pos += 4;
        Some(f64::from(f32::from_le_bytes(raw)))
    }
}

/// Upper-cases a symbol and accepts only what tickers use, such as `AAPL`,
/// `BRK-B`, `VNM.VN`, `^GSPC`, `EURUSD=X` or `BTC-USD`.
pub fn normalize_symbol(input: &str) -> Option<String> {
    let s = input.trim().to_ascii_uppercase();
    let ok = (1..=15).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'^' | b'='));
    ok.then_some(s)
}

/// Encodes the characters of a valid symbol that are special in a URL path.
pub fn url_symbol(symbol: &str) -> String {
    symbol.replace('^', "%5E").replace('=', "%3D")
}

#[derive(Deserialize)]
struct ChartDoc {
    chart: Chart,
}

#[derive(Deserialize)]
struct Chart {
    result: Option<Vec<ChartResult>>,
    error: Option<ChartError>,
}

#[derive(Deserialize)]
struct ChartError {
    description: Option<String>,
}

#[derive(Deserialize)]
struct ChartResult {
    meta: Meta,
    indicators: Option<Indicators>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    symbol: String,
    currency: Option<String>,
    regular_market_price: Option<f64>,
    chart_previous_close: Option<f64>,
    previous_close: Option<f64>,
    short_name: Option<String>,
    long_name: Option<String>,
}

#[derive(Deserialize)]
struct Indicators {
    quote: Vec<Series>,
}

#[derive(Deserialize)]
struct Series {
    close: Option<Vec<Option<f64>>>,
}

/// Every `step`-th value, keeping the last so the line ends at the price.
fn downsample(points: Vec<f64>, max: usize) -> Vec<f64> {
    if points.len() <= max {
        return points;
    }
    let step = points.len().div_ceil(max);
    let last = *points.last().expect("not empty");
    let mut out: Vec<f64> = points.into_iter().step_by(step).collect();
    if out.last() != Some(&last) {
        out.push(last);
    }
    out
}

/// Reads a quote from a chart response.
pub fn parse_chart(body: &str, now_ms: u64) -> Result<Quote, String> {
    let doc: ChartDoc =
        serde_json::from_str(body).map_err(|e| format!("unexpected response: {e}"))?;
    if let Some(e) = doc.chart.error {
        return Err(e.description.unwrap_or_else(|| "not found".into()));
    }
    let result = doc
        .chart
        .result
        .and_then(|r| r.into_iter().next())
        .ok_or("no data")?;
    let meta = result.meta;
    let price = meta
        .regular_market_price
        .filter(|p| p.is_finite())
        .ok_or("no price")?;
    let previous_close = meta
        .chart_previous_close
        .or(meta.previous_close)
        .filter(|p| p.is_finite() && *p > 0.0)
        .unwrap_or(price);
    let points: Vec<f64> = result
        .indicators
        .and_then(|i| i.quote.into_iter().next())
        .and_then(|s| s.close)
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|p| p.is_finite())
        .collect();
    let change = price - previous_close;
    Ok(Quote {
        name: meta
            .short_name
            .or(meta.long_name)
            .unwrap_or_else(|| meta.symbol.clone()),
        symbol: meta.symbol,
        price,
        previous_close,
        change,
        change_percent: change / previous_close * 100.0,
        currency: meta.currency.unwrap_or_default(),
        points: downsample(points, MAX_POINTS),
        updated_at: now_ms,
    })
}

fn agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .user_agent(USER_AGENT);
    if let Ok(tls) = native_tls::TlsConnector::new() {
        builder = builder.tls_connector(Arc::new(tls));
    }
    builder.build()
}

fn fetch(agent: &ureq::Agent, symbol: &str) -> Result<Quote, String> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=5m&range=1d",
        url_symbol(symbol)
    );
    let body = match agent.get(&url).call() {
        Ok(res) => res.into_string().map_err(|e| e.to_string())?,
        // Unknown symbols come back as 404 with an explanation in the body.
        Err(ureq::Error::Status(_, res)) => res.into_string().map_err(|e| e.to_string())?,
        Err(e) => return Err(format!("offline? {e}")),
    };
    parse_chart(&body, now_ms())
}

/// The symbols to refresh, or none while nothing shows quotes.
fn wanted(s: &Settings) -> Vec<String> {
    let shown = s.widgets.contains(&WidgetId::Stocks) || !s.island_stocks.is_empty();
    if shown {
        s.stocks.clone()
    } else {
        Vec::new()
    }
}

fn emit_quotes(app: &AppHandle) {
    let quotes = actions::state(app).read(|i| i.quote_list());
    let _ = app.emit(QUOTES_CHANGED, &quotes);
}

pub fn spawn(app: AppHandle) {
    let streaming = Arc::new(AtomicBool::new(false));
    spawn_poller(app.clone(), streaming.clone());
    spawn_streamer(app, streaming);
}

fn spawn_poller(app: AppHandle, streaming: Arc<AtomicBool>) {
    let spawned = thread::Builder::new()
        .name("islet-market".into())
        .spawn(move || {
            let agent = agent();
            let mut last: Option<(Vec<String>, Instant, bool)> = None;
            loop {
                let st = actions::state(&app);
                if st.read(|i| i.quitting) {
                    break;
                }
                let symbols = st.read(|i| wanted(&i.settings));
                let due = match &last {
                    None => true,
                    Some((prev, at, ok)) => {
                        let every = match (*ok, streaming.load(Ordering::Relaxed)) {
                            (false, _) => RETRY,
                            (true, true) => REFRESH_STREAMING,
                            (true, false) => REFRESH,
                        };
                        *prev != symbols || at.elapsed() >= every
                    }
                };
                if due && !symbols.is_empty() {
                    let mut ok = true;
                    let fresh: BTreeMap<String, Result<Quote, String>> = symbols
                        .iter()
                        .map(|s| {
                            let r = fetch(&agent, s);
                            ok &= r.is_ok();
                            (s.clone(), r)
                        })
                        .collect();
                    st.mutate(|i| {
                        for (symbol, result) in fresh {
                            i.quotes
                                .entry(symbol.clone())
                                .or_insert_with(|| QuoteState::empty(symbol))
                                .merge_chart(result);
                        }
                    });
                    emit_quotes(&app);
                    last = Some((symbols, Instant::now(), ok));
                } else if due {
                    last = Some((symbols, Instant::now(), true));
                }
                thread::sleep(TICK);
            }
        });
    if let Err(e) = spawned {
        log::error!("market thread did not start: {e}");
    }
}

fn spawn_streamer(app: AppHandle, streaming: Arc<AtomicBool>) {
    let spawned = thread::Builder::new()
        .name("islet-market-stream".into())
        .spawn(move || {
            let mut backoff = Duration::from_secs(2);
            loop {
                let st = actions::state(&app);
                if st.read(|i| i.quitting) {
                    break;
                }
                let symbols = st.read(|i| wanted(&i.settings));
                if symbols.is_empty() {
                    thread::sleep(TICK);
                    continue;
                }
                match stream(&app, &symbols, &streaming) {
                    // The symbols changed or Islet is quitting.
                    Ok(()) => backoff = Duration::from_secs(2),
                    Err(e) => {
                        streaming.store(false, Ordering::Relaxed);
                        log::info!("price stream down ({e}); retrying in {backoff:?}");
                        let until = Instant::now() + backoff;
                        while Instant::now() < until && !st.read(|i| i.quitting) {
                            thread::sleep(TICK);
                        }
                        backoff = (backoff * 2).min(Duration::from_secs(60));
                    }
                }
            }
        });
    if let Err(e) = spawned {
        log::error!("price stream thread did not start: {e}");
    }
}

/// Reads with a timeout, so the loop can notice new symbols and quitting.
fn set_read_timeout(ws: &WebSocket<MaybeTlsStream<TcpStream>>, timeout: Duration) {
    let tcp = match ws.get_ref() {
        MaybeTlsStream::Plain(s) => s,
        MaybeTlsStream::NativeTls(s) => s.get_ref(),
        _ => return,
    };
    let _ = tcp.set_read_timeout(Some(timeout));
}

/// Streams prices for `symbols` until they change (Ok) or the connection
/// fails (Err).
fn stream(app: &AppHandle, symbols: &[String], streaming: &AtomicBool) -> Result<(), String> {
    let st = actions::state(app);
    let (mut ws, _) = tungstenite::connect(STREAM_URL).map_err(|e| e.to_string())?;
    set_read_timeout(&ws, Duration::from_secs(1));
    let subscribe = serde_json::json!({ "subscribe": symbols }).to_string();
    ws.send(Message::text(subscribe))
        .map_err(|e| e.to_string())?;
    streaming.store(true, Ordering::Relaxed);
    log::info!("price stream connected for {}", symbols.join(", "));

    let (mut dirty, mut last_emit, mut last_ping) = (false, Instant::now(), Instant::now());
    loop {
        let (quitting, now_wanted) = st.read(|i| (i.quitting, wanted(&i.settings)));
        if quitting || now_wanted != symbols {
            let _ = ws.close(None);
            return Ok(());
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if let Some(tick) = decode_tick(&text) {
                    st.mutate(|i| {
                        if let Some(entry) = i.quotes.get_mut(&tick.symbol) {
                            entry.apply_tick(&tick, now_ms());
                        } else if i.settings.stocks.contains(&tick.symbol) {
                            let mut entry = QuoteState::empty(tick.symbol.clone());
                            entry.apply_tick(&tick, now_ms());
                            i.quotes.insert(tick.symbol.clone(), entry);
                        }
                    });
                    dirty = true;
                }
            }
            Ok(Message::Close(_)) => return Err("closed by Yahoo".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => return Err(e.to_string()),
        }
        if dirty && last_emit.elapsed() >= EMIT_EVERY {
            emit_quotes(app);
            dirty = false;
            last_emit = Instant::now();
        }
        if last_ping.elapsed() >= PING_EVERY {
            ws.send(Message::Ping(Default::default()))
                .map_err(|e| e.to_string())?;
            last_ping = Instant::now();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AAPL: &str = r#"{"chart":{"result":[{"meta":{"currency":"USD","symbol":"AAPL","regularMarketPrice":342.37,"chartPreviousClose":344.17,"previousClose":344.17,"shortName":"Apple Inc.","longName":"Apple Inc."},"timestamp":[1,2,3],"indicators":{"quote":[{"close":[340.8,null,342.37]}]}}],"error":null}}"#;

    #[test]
    fn parses_price_change_and_points() {
        let q = parse_chart(AAPL, 7).unwrap();
        assert_eq!(q.symbol, "AAPL");
        assert_eq!(q.name, "Apple Inc.");
        assert_eq!(q.currency, "USD");
        assert!((q.change - (-1.8)).abs() < 1e-9);
        assert!((q.change_percent - (-1.8 / 344.17 * 100.0)).abs() < 1e-9);
        assert_eq!(q.points, vec![340.8, 342.37]);
        assert_eq!(q.updated_at, 7);
    }

    /// A real BTC-USD message from the stream.
    const BTC_TICK: &str = r#"{"type":"pricing","message":"CgdCVEMtVVNEFQgFkUcY0LDn77doIgNVU0QqA0NDQzApOAFF8ej4v0iAoIPMlwFVaF6TR13MApFHZUAQuMR96e+RR7ABgKCDzJcB2AEE4AGAoIPMlwHoAYCgg8yXAfIBA0JUQ4ECAAAAAJ4tc0GJAgAAZX+ku3VC9QJAELjE/QLx6Pi/"}"#;

    #[test]
    fn decodes_stream_ticks() {
        let t = decode_tick(BTC_TICK).unwrap();
        assert_eq!(t.symbol, "BTC-USD");
        assert!((t.price - 74250.0625).abs() < 1e-3);
        assert!((t.previous_close.unwrap() - 74719.82).abs() < 0.01);
        assert_eq!(decode_tick(r#"{"type":"pricing","message":"!!"}"#), None);
        assert_eq!(decode_tick("not json"), None);
        // A truncated message is rejected rather than misread.
        assert_eq!(decode_tick(r#"{"message":"CgdCVEMtVVNEFQgF"}"#), None);
    }

    #[test]
    fn ticks_move_the_price_and_the_chart_does_not_undo_them() {
        let mut s = QuoteState::empty("AAPL".into());
        s.merge_chart(parse_chart(AAPL, 1));
        let tick = Tick {
            symbol: "AAPL".into(),
            price: 350.0,
            previous_close: None,
        };
        s.apply_tick(&tick, 2);
        let q = s.quote.clone().unwrap();
        assert_eq!(q.price, 350.0);
        assert!((q.change - (350.0 - 344.17)).abs() < 1e-9);
        assert_eq!(q.points.last(), Some(&350.0));
        // The next chart load has the older price; the streamed one stays.
        s.merge_chart(parse_chart(AAPL, 3));
        let q = s.quote.unwrap();
        assert_eq!(q.price, 350.0);
        assert_eq!(q.name, "Apple Inc.");
    }

    #[test]
    fn unknown_symbols_explain_why() {
        let body = r#"{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found, symbol may be delisted"}}}"#;
        assert_eq!(
            parse_chart(body, 0).unwrap_err(),
            "No data found, symbol may be delisted"
        );
        assert!(parse_chart("<html>", 0).is_err());
    }

    #[test]
    fn symbols_are_normalized_and_checked() {
        assert_eq!(normalize_symbol(" aapl ").as_deref(), Some("AAPL"));
        assert_eq!(normalize_symbol("btc-usd").as_deref(), Some("BTC-USD"));
        assert_eq!(normalize_symbol("^gspc").as_deref(), Some("^GSPC"));
        assert_eq!(normalize_symbol("vnm.vn").as_deref(), Some("VNM.VN"));
        assert_eq!(normalize_symbol(""), None);
        assert_eq!(normalize_symbol("AAPL/../x"), None);
        assert_eq!(normalize_symbol("A B"), None);
        assert_eq!(url_symbol("^GSPC"), "%5EGSPC");
        assert_eq!(url_symbol("EURUSD=X"), "EURUSD%3DX");
    }

    /// Hits the network; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_quotes_load() {
        let agent = agent();
        let q = fetch(&agent, "AAPL").unwrap();
        assert!(q.price > 0.0 && !q.points.is_empty(), "{q:?}");
        assert!(fetch(&agent, "BTC-USD").is_ok());
        assert!(fetch(&agent, "NOPE123XYZ").is_err());
    }

    /// Hits the network; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_stream_connects() {
        let (mut ws, _) = tungstenite::connect(STREAM_URL).unwrap();
        let sub = serde_json::json!({ "subscribe": ["BTC-USD", "ETH-USD"] }).to_string();
        ws.send(Message::text(sub)).unwrap();
        set_read_timeout(&ws, Duration::from_secs(20));
        let tick = loop {
            if let Message::Text(t) = ws.read().unwrap() {
                if let Some(tick) = decode_tick(&t) {
                    break tick;
                }
            }
        };
        assert!(tick.price > 0.0, "{tick:?}");
    }

    #[test]
    fn long_series_are_thinned_but_end_at_the_price() {
        let points: Vec<f64> = (0..200).map(f64::from).collect();
        let out = downsample(points, MAX_POINTS);
        assert!(out.len() <= MAX_POINTS + 1);
        assert_eq!(out.first(), Some(&0.0));
        assert_eq!(out.last(), Some(&199.0));
    }
}
