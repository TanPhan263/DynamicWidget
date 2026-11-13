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
//!
//! Vietnamese stocks (`.VN`) skip Yahoo, whose data for them is delayed:
//! the VN poller reads live prices from VPS every few seconds, and the
//! chart round reads the sparkline from VNDirect's 1-minute bars.

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
const VN_EVERY: Duration = Duration::from_secs(3);
const VPS_URL: &str = "https://bgapidatafeed.vps.com.vn/getliststockdata/";
const VPS_INDEX_URL: &str = "https://bgapidatafeed.vps.com.vn/getlistindexdetail/";
/// `^NAME.VN` index names, with their VPS code and VNDirect bar symbol.
const VN_INDEXES: &[(&str, &str, &str)] = &[
    ("VNINDEX", "10", "VNINDEX"),
    ("VINDEX", "10", "VNINDEX"),
    ("VN30", "11", "VN30"),
    ("HNX", "02", "HNX"),
    ("HNXINDEX", "02", "HNX"),
    ("HNX30", "12", "HNX30"),
    ("UPCOM", "03", "UPCOM"),
    ("UPCOMINDEX", "03", "UPCOM"),
];
const VND_BARS_URL: &str = "https://dchart-api.vndirect.com.vn/dchart/history";
/// Covers weekends and Tet, so the latest session is always in range.
const VND_LOOKBACK_SECS: u64 = 14 * 86_400;
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Lintel";

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
    /// Shares traded today, when the source reports it.
    pub volume: Option<f64>,
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
            volume: None,
            updated_at: now_ms,
        });
        if tick.volume.is_some() {
            q.volume = tick.volume;
        }
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
    /// Shares traded today; Yahoo's stream leaves it out.
    pub volume: Option<f64>,
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
        volume: None,
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
    regular_market_volume: Option<f64>,
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
        volume: meta.regular_market_volume.filter(|v| v.is_finite()),
        updated_at: now_ms,
    })
}

pub(crate) fn agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        // VPS lists a dead address first; fail it fast so the next one is tried.
        .timeout_connect(Duration::from_secs(2))
        .user_agent(USER_AGENT);
    if let Ok(tls) = native_tls::TlsConnector::new() {
        builder = builder.tls_connector(Arc::new(tls));
    }
    builder.build()
}

fn fetch(agent: &ureq::Agent, symbol: &str) -> Result<Quote, String> {
    if is_vn(symbol) {
        return fetch_vn(agent, symbol);
    }
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

fn is_vn(symbol: &str) -> bool {
    symbol.ends_with(".VN")
}

/// The VPS code and VNDirect bar symbol of an index such as `^VNINDEX.VN`.
fn vn_index(symbol: &str) -> Option<(&'static str, &'static str)> {
    let name = symbol.strip_prefix('^')?.strip_suffix(".VN")?;
    VN_INDEXES
        .iter()
        .find(|(n, _, _)| *n == name)
        .map(|(_, code, bars)| (*code, *bars))
}

fn get_text(agent: &ureq::Agent, url: &str) -> Result<String, String> {
    agent
        .get(url)
        .call()
        .map_err(|e| format!("offline? {e}"))?
        .into_string()
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct VpsRow {
    sym: String,
    #[serde(rename = "lastPrice")]
    last_price: Option<f64>,
    /// Reference price: the previous session's close.
    r: Option<f64>,
    /// Volume today, in lots of 10 shares.
    lot: Option<f64>,
}

/// Reads VPS's snapshot rows, which quote prices in thousands of dong.
pub fn parse_vps(body: &str) -> Result<Vec<Tick>, String> {
    let rows: Vec<VpsRow> =
        serde_json::from_str(body).map_err(|e| format!("unexpected response: {e}"))?;
    let ok = |p: Option<f64>| p.filter(|p| p.is_finite() && *p > 0.0);
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let reference = ok(row.r)?;
            // lastPrice is 0 until the first trade of the session.
            let price = ok(row.last_price).unwrap_or(reference);
            Some(Tick {
                symbol: format!("{}.VN", row.sym.to_ascii_uppercase()),
                price: price * 1000.0,
                previous_close: Some(reference * 1000.0),
                volume: row.lot.filter(|v| v.is_finite()).map(|v| v * 10.0),
            })
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VpsIndexRow {
    mc: String,
    c_index: Option<f64>,
    /// Reference value: the previous session's close.
    o_index: Option<f64>,
    /// Shares traded today across the index.
    vol: Option<f64>,
}

/// Reads VPS's index rows (in points) as ticks for the wanted index symbols.
pub fn parse_vps_indexes(body: &str, symbols: &[String]) -> Result<Vec<Tick>, String> {
    let rows: Vec<VpsIndexRow> =
        serde_json::from_str(body).map_err(|e| format!("unexpected response: {e}"))?;
    let ok = |p: Option<f64>| p.filter(|p| p.is_finite() && *p > 0.0);
    Ok(symbols
        .iter()
        .filter_map(|symbol| {
            let (code, _) = vn_index(symbol)?;
            let row = rows.iter().find(|r| r.mc == code)?;
            let reference = ok(row.o_index)?;
            Some(Tick {
                symbol: symbol.clone(),
                price: ok(row.c_index).unwrap_or(reference),
                previous_close: Some(reference),
                volume: row.vol.filter(|v| v.is_finite()),
            })
        })
        .collect())
}

/// Live prices for `.VN` stocks and indexes, at most one request each.
fn fetch_vps(agent: &ureq::Agent, symbols: &[String]) -> Result<Vec<Tick>, String> {
    let (indexes, stocks): (Vec<String>, Vec<String>) =
        symbols.iter().cloned().partition(|s| vn_index(s).is_some());
    let mut ticks = Vec::new();
    if !stocks.is_empty() {
        let codes: Vec<String> = stocks
            .iter()
            .map(|s| url_symbol(s.trim_end_matches(".VN")))
            .collect();
        ticks.extend(parse_vps(&get_text(
            agent,
            &format!("{VPS_URL}{}", codes.join(",")),
        )?)?);
    }
    if !indexes.is_empty() {
        let mut codes: Vec<&str> = indexes
            .iter()
            .filter_map(|s| vn_index(s))
            .map(|(c, _)| c)
            .collect();
        codes.dedup();
        let body = get_text(agent, &format!("{VPS_INDEX_URL}{}", codes.join(",")))?;
        ticks.extend(parse_vps_indexes(&body, &indexes)?);
    }
    Ok(ticks)
}

#[derive(Deserialize)]
struct Bars {
    t: Vec<u64>,
    c: Vec<f64>,
}

/// Closes of the latest session in VNDirect's 1-minute bars, times `scale`.
pub fn parse_vnd_bars(body: &str, scale: f64) -> Vec<f64> {
    let Ok(bars) = serde_json::from_str::<Bars>(body) else {
        return Vec::new();
    };
    // Sessions are split by the day in Vietnam (UTC+7).
    let day = |t: u64| (t + 7 * 3600) / 86_400;
    let Some(last) = bars.t.last().map(|t| day(*t)) else {
        return Vec::new();
    };
    let closes = bars
        .t
        .iter()
        .zip(bars.c)
        .filter(|(t, c)| day(**t) == last && c.is_finite())
        .map(|(_, c)| c * scale)
        .collect();
    downsample(closes, MAX_POINTS)
}

fn fetch_vn(agent: &ureq::Agent, symbol: &str) -> Result<Quote, String> {
    let tick = fetch_vps(agent, &[symbol.to_string()])?
        .into_iter()
        .next()
        .ok_or("not found on HOSE, HNX or UPCoM")?;
    // Stocks are quoted in thousands of dong, indexes in points.
    let (code, scale, currency) = match vn_index(symbol) {
        Some((_, bars)) => (bars, 1.0, ""),
        None => (symbol.trim_end_matches(".VN"), 1000.0, "VND"),
    };
    let to = now_ms() / 1000;
    let url = format!(
        "{VND_BARS_URL}?resolution=1&symbol={}&from={}&to={to}",
        url_symbol(code),
        to - VND_LOOKBACK_SECS
    );
    // The sparkline is optional; the price still shows without it.
    let points = get_text(agent, &url)
        .map(|b| parse_vnd_bars(&b, scale))
        .unwrap_or_default();
    let mut q = Quote {
        symbol: symbol.to_string(),
        name: code.to_string(),
        price: tick.price,
        previous_close: tick.previous_close.unwrap_or(tick.price),
        change: 0.0,
        change_percent: 0.0,
        currency: currency.into(),
        points,
        volume: tick.volume,
        updated_at: 0,
    };
    set_price(&mut q, tick.price, now_ms());
    Ok(q)
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

/// The wanted symbols Yahoo's stream should carry.
fn streamed(s: &Settings) -> Vec<String> {
    wanted(s).into_iter().filter(|s| !is_vn(s)).collect()
}

fn emit_quotes(app: &AppHandle) {
    let quotes = actions::state(app).read(|i| i.quote_list());
    let _ = app.emit(QUOTES_CHANGED, &quotes);
}

pub fn spawn(app: AppHandle) {
    let streaming = Arc::new(AtomicBool::new(false));
    spawn_poller(app.clone(), streaming.clone());
    spawn_streamer(app.clone(), streaming);
    spawn_vn_poller(app);
}

fn spawn_vn_poller(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("lintel-market-vn".into())
        .spawn(move || {
            let agent = agent();
            loop {
                let st = actions::state(&app);
                if st.read(|i| i.quitting) {
                    break;
                }
                let symbols: Vec<String> = st
                    .read(|i| wanted(&i.settings))
                    .into_iter()
                    .filter(|s| is_vn(s))
                    .collect();
                if !symbols.is_empty() {
                    match fetch_vps(&agent, &symbols) {
                        Ok(ticks) => {
                            // The chart round creates entries; ticks only move them.
                            // Sent on only when a price moved, so a closed market redraws nothing.
                            let shown = |e: &QuoteState| {
                                e.quote
                                    .as_ref()
                                    .map(|q| (q.price, q.volume, q.previous_close))
                            };
                            let moved = st.mutate(|i| {
                                let mut moved = false;
                                for tick in &ticks {
                                    if let Some(entry) = i.quotes.get_mut(&tick.symbol) {
                                        let before = shown(entry);
                                        entry.apply_tick(tick, now_ms());
                                        moved |= shown(entry) != before;
                                    }
                                }
                                moved
                            });
                            if moved {
                                emit_quotes(&app);
                            }
                        }
                        Err(e) => log::debug!("VN prices failed: {e}"),
                    }
                }
                // shortcut: polls around the clock, add a HOSE trading-hours check if the traffic matters.
                thread::sleep(VN_EVERY);
            }
        });
    if let Err(e) = spawned {
        log::error!("VN price thread did not start: {e}");
    }
}

fn spawn_poller(app: AppHandle, streaming: Arc<AtomicBool>) {
    let spawned = thread::Builder::new()
        .name("lintel-market".into())
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
        .name("lintel-market-stream".into())
        .spawn(move || {
            let mut backoff = Duration::from_secs(2);
            loop {
                let st = actions::state(&app);
                if st.read(|i| i.quitting) {
                    break;
                }
                let symbols = st.read(|i| streamed(&i.settings));
                if symbols.is_empty() {
                    thread::sleep(TICK);
                    continue;
                }
                match stream(&app, &symbols, &streaming) {
                    // The symbols changed or Lintel is quitting.
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
        let (quitting, now_wanted) = st.read(|i| (i.quitting, streamed(&i.settings)));
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
            volume: None,
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
    fn vps_rows_become_ticks_in_dong() {
        let body = r#"[{"sym":"VNM","lastPrice":57.5,"r":56.9,"lot":16570},{"sym":"FPT","lastPrice":0,"r":51.7},{"sym":"X","r":0}]"#;
        let ticks = parse_vps(body).unwrap();
        assert_eq!(ticks.len(), 2);
        assert_eq!(ticks[0].symbol, "VNM.VN");
        assert_eq!(ticks[0].price, 57_500.0);
        assert_eq!(ticks[0].previous_close, Some(56_900.0));
        assert_eq!(ticks[0].volume, Some(165_700.0));
        assert_eq!(ticks[1].volume, None);
        // No trade yet: the reference price stands in.
        assert_eq!(ticks[1].price, 51_700.0);
        assert!(parse_vps("<html>").is_err());
    }

    #[test]
    fn vnd_bars_keep_only_the_latest_session() {
        // 1793932080 is 2026-11-06 09:28 in Vietnam; +3 days is 2026-11-09.
        let (fri, mon) = (1_793_932_080u64, 1_793_932_080u64 + 3 * 86_400);
        let body = format!(
            r#"{{"t":[{fri},{mon},{}],"c":[50.0,51.0,51.7],"s":"ok"}}"#,
            mon + 60
        );
        assert_eq!(parse_vnd_bars(&body, 1000.0), vec![51_000.0, 51_700.0]);
        assert!(parse_vnd_bars("{}", 1000.0).is_empty());
    }

    #[test]
    fn vps_index_rows_match_index_symbols() {
        let body = r#"[{"mc":"10","cIndex":1724.87,"oIndex":1714.32,"vol":67609420},{"mc":"12","cIndex":224.2,"oIndex":224.2}]"#;
        let wanted = [
            "^VINDEX.VN".to_string(),
            "^VNINDEX.VN".into(),
            "^VN30.VN".into(),
        ];
        let ticks = parse_vps_indexes(body, &wanted).unwrap();
        assert_eq!(ticks.len(), 2, "VN30 has no row");
        assert_eq!(ticks[0].symbol, "^VINDEX.VN");
        assert_eq!(ticks[1].price, 1724.87);
        assert_eq!(ticks[1].previous_close, Some(1714.32));
        assert_eq!(ticks[1].volume, Some(67_609_420.0));
        assert_eq!(vn_index("VNINDEX.VN"), None, "an index needs the ^");
    }

    /// Hits the network; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_vn_quotes_load() {
        let agent = agent();
        let q = fetch(&agent, "FPT.VN").unwrap();
        assert!(q.price > 1000.0 && q.currency == "VND", "{q:?}");
        assert!(fetch(&agent, "ZZZZ.VN").is_err());
        let idx = fetch(&agent, "^VINDEX.VN").unwrap();
        assert!(idx.price > 100.0 && !idx.points.is_empty(), "{idx:?}");
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
