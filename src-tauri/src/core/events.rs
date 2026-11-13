//! Upcoming events for the Events widget from the calendar links (`.ics`,
//! `webcal://`) the user adds. Google Calendar, iCloud and Outlook all give one.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use chrono::{
    DateTime, Datelike, Duration, FixedOffset, Local, LocalResult, Months, NaiveDate,
    NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday,
};
use chrono_tz::Tz;
use serde::Serialize;

use super::news;

/// Most calendars a user can add.
pub const MAX_CALENDARS: usize = 8;
/// Most events sent to the widget, soonest first.
const MAX_EVENTS: usize = 30;
/// How far ahead the widget looks.
const AHEAD_DAYS: i64 = 30;
/// Stops a rule that never ends from looping forever.
const MAX_PERIODS: i64 = 50_000;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Empty when the calendar gives no title.
    pub title: String,
    /// Unix milliseconds. All-day events start at local midnight.
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub location: Option<String>,
    /// The calendar's name.
    pub calendar: String,
}

/// How one calendar link is doing, for Settings.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarState {
    pub url: String,
    pub title: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Events {
    pub events: Vec<Event>,
    pub calendars: Vec<CalendarState>,
}

/// Turns `webcal://` into `https://` and adds `https://` to a bare address;
/// None when it still is not a web link.
pub fn normalize_calendar_url(input: &str) -> Option<String> {
    let s = input.trim();
    match s.get(..9) {
        Some(scheme) if scheme.eq_ignore_ascii_case("webcal://") => {
            news::normalize_feed_url(&format!("https://{}", &s[9..]))
        }
        _ => news::normalize_feed_url(s),
    }
}

// shortcut: a small hand-written iCalendar reader. Repeats cover FREQ
// DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY and
// BYMONTHDAY, plus EXDATE and moved occurrences; BYSETPOS, BYMONTH, WKST and
// RDATE are ignored. Switch to an iCalendar crate if real calendars show wrong times.

#[derive(Clone, Copy, Debug, PartialEq)]
enum Zone {
    Utc,
    Named(Tz),
    /// From the calendar's own time zone block, when the name is unknown.
    Fixed(FixedOffset),
    /// No zone given: this computer's.
    Floating,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Clone, Debug, PartialEq)]
struct Rule {
    freq: Freq,
    interval: i64,
    count: Option<u32>,
    /// Unix milliseconds, inclusive.
    until: Option<i64>,
    /// (n, day): the nth such day of the month, from the end when negative; 0 is every one.
    by_day: Vec<(i32, Weekday)>,
    by_month_day: Vec<i32>,
}

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    uid: String,
    title: String,
    location: Option<String>,
    start: NaiveDateTime,
    zone: Zone,
    all_day: bool,
    /// Milliseconds.
    length: i64,
    rule: Option<Rule>,
    except: HashSet<i64>,
    /// Set on an occurrence moved or cancelled on its own: the start it replaces.
    replaces: Option<i64>,
    cancelled: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Calendar {
    title: String,
    entries: Vec<Entry>,
}

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// One content line: name, parameters and value.
struct Line<'a> {
    name: &'a str,
    params: Vec<(&'a str, &'a str)>,
    value: &'a str,
}

impl Line<'_> {
    fn param(&self, name: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.trim_matches('"'))
    }
}

/// Splits `NAME;PARAM=x:value`; a colon inside a quoted parameter is not the split.
fn split_line(line: &str) -> Option<Line<'_>> {
    let mut quoted = false;
    let colon = line.char_indices().find_map(|(i, c)| {
        if c == '"' {
            quoted = !quoted;
        }
        (c == ':' && !quoted).then_some(i)
    })?;
    let mut head = line[..colon].split(';');
    let name = head.next()?;
    let params = head.filter_map(|p| p.split_once('=')).collect();
    Some(Line {
        name,
        params,
        value: &line[colon + 1..],
    })
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push(' '),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A zone name as calendars write it, such as `Europe/Berlin` or
/// `/mozilla.org/20050126_1/Europe/Berlin`.
fn named_zone(id: &str, offsets: &HashMap<String, FixedOffset>) -> Zone {
    let mut rest = id.trim_matches('"');
    loop {
        if let Ok(tz) = rest.parse::<Tz>() {
            return Zone::Named(tz);
        }
        match rest.split_once('/') {
            Some((_, after)) if !after.is_empty() => rest = after,
            _ => break,
        }
    }
    offsets
        .get(id)
        .map(|o| Zone::Fixed(*o))
        .unwrap_or(Zone::Floating)
}

/// `+0700` or `-0530`.
fn parse_offset(s: &str) -> Option<FixedOffset> {
    let sign = match s.get(..1)? {
        "+" => 1,
        "-" => -1,
        _ => return None,
    };
    let hours: i32 = s.get(1..3)?.parse().ok()?;
    let minutes: i32 = s.get(3..5)?.parse().ok()?;
    FixedOffset::east_opt(sign * (hours * 3600 + minutes * 60))
}

/// A DTSTART-like value: the local time, its zone, and whether it is a whole day.
fn parse_when(
    line: &Line,
    default: Zone,
    offsets: &HashMap<String, FixedOffset>,
) -> Option<(NaiveDateTime, Zone, bool)> {
    let v = line.value.trim();
    // A list such as EXDATE's is read one value at a time by the caller.
    if line
        .param("VALUE")
        .is_some_and(|x| x.eq_ignore_ascii_case("DATE"))
        || v.len() == 8
    {
        let day = NaiveDate::parse_from_str(v, "%Y%m%d").ok()?;
        return Some((day.and_time(NaiveTime::MIN), Zone::Floating, true));
    }
    let (v, utc) = match v.strip_suffix('Z') {
        Some(rest) => (rest, true),
        None => (v, false),
    };
    let at = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
    let zone = if utc {
        Zone::Utc
    } else if let Some(id) = line.param("TZID") {
        named_zone(id, offsets)
    } else {
        default
    };
    Some((at, zone, false))
}

/// Unix milliseconds for a local time; a time skipped by a clock change moves an hour on.
fn ms(at: NaiveDateTime, zone: Zone) -> i64 {
    fn pick<T: TimeZone>(r: LocalResult<DateTime<T>>) -> Option<i64> {
        match r {
            LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => Some(t.timestamp_millis()),
            LocalResult::None => None,
        }
    }
    let local = |at: NaiveDateTime| match zone {
        Zone::Utc => Some(at.and_utc().timestamp_millis()),
        Zone::Named(tz) => pick(tz.from_local_datetime(&at)),
        Zone::Fixed(o) => pick(o.from_local_datetime(&at)),
        Zone::Floating => pick(Local.from_local_datetime(&at)),
    };
    local(at)
        .or_else(|| local(at + Duration::hours(1)))
        .unwrap_or_else(|| at.and_utc().timestamp_millis())
}

/// `P1D`, `PT1H30M`, `P2W`; seconds aside, enough for event lengths.
fn parse_duration(s: &str) -> Option<i64> {
    let s = s.trim().strip_prefix('+').unwrap_or(s.trim());
    let (sign, s) = match s.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, s),
    };
    let s = s.strip_prefix('P')?;
    let (mut total, mut number) = (0i64, String::new());
    for c in s.chars() {
        match c {
            '0'..='9' => number.push(c),
            'T' => {}
            unit => {
                let n: i64 = number.parse().ok()?;
                number.clear();
                total += n * match unit {
                    'W' => 7 * DAY_MS,
                    'D' => DAY_MS,
                    'H' => 3_600_000,
                    'M' => 60_000,
                    'S' => 1000,
                    _ => return None,
                };
            }
        }
    }
    Some(sign * total)
}

fn weekday(code: &str) -> Option<Weekday> {
    Some(match code {
        "MO" => Weekday::Mon,
        "TU" => Weekday::Tue,
        "WE" => Weekday::Wed,
        "TH" => Weekday::Thu,
        "FR" => Weekday::Fri,
        "SA" => Weekday::Sat,
        "SU" => Weekday::Sun,
        _ => return None,
    })
}

/// None for a rule this reader cannot follow; the event then shows once.
fn parse_rule(value: &str, zone: Zone, offsets: &HashMap<String, FixedOffset>) -> Option<Rule> {
    let parts: HashMap<String, &str> = value
        .split(';')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v))
        .collect();
    let freq = match parts.get("FREQ")?.to_ascii_uppercase().as_str() {
        "DAILY" => Freq::Daily,
        "WEEKLY" => Freq::Weekly,
        "MONTHLY" => Freq::Monthly,
        "YEARLY" => Freq::Yearly,
        _ => return None,
    };
    let until = parts.get("UNTIL").and_then(|v| {
        let line = Line {
            name: "UNTIL",
            params: Vec::new(),
            value: v,
        };
        let (at, z, day) = parse_when(&line, zone, offsets)?;
        // A date-only end includes that whole day.
        Some(if day {
            ms(at, zone) + DAY_MS - 1
        } else {
            ms(at, if z == Zone::Utc { z } else { zone })
        })
    });
    let by_day = parts
        .get("BYDAY")
        .map(|v| {
            v.split(',')
                .filter_map(|d| {
                    let d = d.trim().to_ascii_uppercase();
                    let (n, code) = d.split_at(d.len().checked_sub(2)?);
                    Some((n.parse().unwrap_or(0), weekday(code)?))
                })
                .collect()
        })
        .unwrap_or_default();
    let by_month_day = parts
        .get("BYMONTHDAY")
        .map(|v| v.split(',').filter_map(|d| d.trim().parse().ok()).collect())
        .unwrap_or_default();
    Some(Rule {
        freq,
        interval: parts
            .get("INTERVAL")
            .and_then(|v| v.parse().ok())
            .filter(|n: &i64| *n > 0)
            .unwrap_or(1),
        count: parts.get("COUNT").and_then(|v| v.parse().ok()),
        until,
        by_day,
        by_month_day,
    })
}

/// Reads an iCalendar document; `url` names a calendar without a title.
fn parse_calendar(body: &str, url: &str) -> Result<Calendar, String> {
    let body = body.trim_start_matches('\u{feff}');
    if !body.trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err("this address is not a calendar link".into());
    }
    // Long lines continue on lines that start with a space or tab.
    let unfolded = body
        .replace("\r\n", "\n")
        .replace("\n ", "")
        .replace("\n\t", "");
    let lines: Vec<Line> = unfolded.lines().filter_map(split_line).collect();

    let mut title = None;
    let mut default = Zone::Floating;
    let mut offsets = HashMap::new();
    let (mut tzid, mut in_standard) = (None, false);
    for l in &lines {
        match (l.name.to_ascii_uppercase().as_str(), l.value) {
            ("X-WR-CALNAME", v) => title = Some(unescape(v)),
            ("TZID", v) => tzid = Some(v.to_string()),
            ("BEGIN", "STANDARD") => in_standard = true,
            ("END", "STANDARD") => in_standard = false,
            ("TZOFFSETTO", v) if in_standard => {
                if let (Some(id), Some(o)) = (&tzid, parse_offset(v.trim())) {
                    offsets.entry(id.clone()).or_insert(o);
                }
            }
            _ => {}
        }
    }
    if let Some(l) = lines
        .iter()
        .find(|l| l.name.eq_ignore_ascii_case("X-WR-TIMEZONE"))
    {
        default = named_zone(l.value.trim(), &offsets);
    }

    let mut entries = Vec::new();
    // Nested blocks such as alarms sit inside an event; only its own lines count.
    let mut depth = Vec::new();
    let mut lines_of_event: Vec<&Line> = Vec::new();
    for l in &lines {
        if l.name.eq_ignore_ascii_case("BEGIN") {
            depth.push(l.value.trim().to_ascii_uppercase());
            continue;
        }
        if l.name.eq_ignore_ascii_case("END") {
            if depth.pop().as_deref() == Some("VEVENT") {
                if let Some(e) = entry(&lines_of_event, default, &offsets) {
                    entries.push(e);
                }
                lines_of_event.clear();
            }
            continue;
        }
        if depth.last().map(String::as_str) == Some("VEVENT") {
            lines_of_event.push(l);
        }
    }
    Ok(Calendar {
        title: title
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| news::host(url)),
        entries,
    })
}

fn entry(lines: &[&Line], default: Zone, offsets: &HashMap<String, FixedOffset>) -> Option<Entry> {
    let get = |name: &str| lines.iter().find(|l| l.name.eq_ignore_ascii_case(name));
    let (start, zone, all_day) = parse_when(get("DTSTART")?, default, offsets)?;
    let begins = ms(start, zone);
    let length = if let Some((end, end_zone, _)) =
        get("DTEND").and_then(|l| parse_when(l, default, offsets))
    {
        ms(end, end_zone) - begins
    } else if let Some(d) = get("DURATION").and_then(|l| parse_duration(l.value)) {
        d
    } else if all_day {
        DAY_MS
    } else {
        0
    };
    let except = lines
        .iter()
        .filter(|l| l.name.eq_ignore_ascii_case("EXDATE"))
        .flat_map(|l| {
            l.value.split(',').filter_map(|v| {
                let one = Line {
                    name: l.name,
                    params: l.params.clone(),
                    value: v,
                };
                let (at, z, _) = parse_when(&one, zone, offsets)?;
                Some(ms(at, z))
            })
        })
        .collect();
    Some(Entry {
        uid: get("UID")
            .map(|l| l.value.trim().to_string())
            .unwrap_or_default(),
        title: get("SUMMARY")
            .map(|l| unescape(l.value))
            .unwrap_or_default(),
        location: get("LOCATION")
            .map(|l| unescape(l.value))
            .filter(|s| !s.is_empty()),
        start,
        zone,
        all_day,
        length: length.max(0),
        rule: get("RRULE").and_then(|l| parse_rule(l.value, zone, offsets)),
        except,
        replaces: get("RECURRENCE-ID")
            .and_then(|l| parse_when(l, zone, offsets))
            .map(|(at, z, _)| ms(at, z)),
        cancelled: get("STATUS").is_some_and(|l| l.value.trim().eq_ignore_ascii_case("CANCELLED")),
    })
}

/// The days of the month a monthly rule names, in order.
fn month_days(year: i32, month: u32, rule: &Rule, first: NaiveDate) -> Vec<NaiveDate> {
    let Some(start) = NaiveDate::from_ymd_opt(year, month, 1) else {
        return Vec::new();
    };
    let last = (start + Months::new(1)).pred_opt().map_or(28, |d| d.day()) as i32;
    let all: Vec<NaiveDate> = (0..last)
        .map(|i| start + Duration::days(i as i64))
        .collect();
    let mut days: Vec<NaiveDate> = if !rule.by_day.is_empty() {
        rule.by_day
            .iter()
            .flat_map(|&(n, wd)| {
                let matching: Vec<NaiveDate> =
                    all.iter().copied().filter(|d| d.weekday() == wd).collect();
                match n {
                    0 => matching,
                    n if n > 0 => matching.get(n as usize - 1).copied().into_iter().collect(),
                    n => matching
                        .len()
                        .checked_sub(n.unsigned_abs() as usize)
                        .map(|i| matching[i])
                        .into_iter()
                        .collect(),
                }
            })
            .collect()
    } else {
        let wanted = if rule.by_month_day.is_empty() {
            vec![first.day() as i32]
        } else {
            rule.by_month_day.clone()
        };
        wanted
            .into_iter()
            .filter_map(|d| {
                let d = if d < 0 { last + 1 + d } else { d };
                (1..=last).contains(&d).then(|| all[d as usize - 1])
            })
            .collect()
    };
    days.sort();
    days.dedup();
    days
}

/// Each start of `e` (Unix ms) before `to`, in order, including the first.
fn starts(e: &Entry, to: i64) -> Vec<i64> {
    let first = ms(e.start, e.zone);
    let Some(rule) = &e.rule else {
        return vec![first];
    };
    let day0 = e.start.date();
    let time = e.start.time();
    let mut out = Vec::new();
    let mut counted = 0u32;
    for period in 0..MAX_PERIODS {
        let step = period * rule.interval;
        let days: Vec<NaiveDate> = match rule.freq {
            Freq::Daily => vec![day0 + Duration::days(step)],
            Freq::Weekly => {
                let monday = day0 - Duration::days(day0.weekday().num_days_from_monday() as i64)
                    + Duration::weeks(step);
                let mut wds: Vec<Weekday> = rule.by_day.iter().map(|&(_, wd)| wd).collect();
                if wds.is_empty() {
                    wds.push(day0.weekday());
                }
                let mut days: Vec<NaiveDate> = wds
                    .iter()
                    .map(|wd| monday + Duration::days(wd.num_days_from_monday() as i64))
                    .collect();
                days.sort();
                days.dedup();
                days
            }
            Freq::Monthly => {
                let Some(month) = NaiveDate::from_ymd_opt(day0.year(), day0.month(), 1)
                    .and_then(|m| m.checked_add_months(Months::new(step as u32)))
                else {
                    break;
                };
                month_days(month.year(), month.month(), rule, day0)
            }
            Freq::Yearly => {
                NaiveDate::from_ymd_opt(day0.year() + step as i32, day0.month(), day0.day())
                    .into_iter()
                    .collect()
            }
        };
        for day in days.into_iter().filter(|d| *d >= day0) {
            let at = ms(day.and_time(time), e.zone);
            if rule.until.is_some_and(|u| at > u) || at >= to {
                return out;
            }
            counted += 1;
            if rule.count.is_some_and(|c| counted > c) {
                return out;
            }
            if !e.except.contains(&at) {
                out.push(at);
            }
        }
    }
    out
}

/// The events of `cal` still going on at `from` or starting before `to`.
fn expand(cal: &Calendar, from: i64, to: i64) -> Vec<Event> {
    let moved: HashSet<(&str, i64)> = cal
        .entries
        .iter()
        .filter_map(|e| Some((e.uid.as_str(), e.replaces?)))
        .collect();
    let mut out = Vec::new();
    for e in &cal.entries {
        if e.cancelled {
            continue;
        }
        for start in starts(e, to) {
            let end = start + e.length;
            let replaced = e.replaces.is_none() && moved.contains(&(e.uid.as_str(), start));
            if end.max(start + 1) > from && start < to && !replaced {
                out.push(Event {
                    title: e.title.clone(),
                    start,
                    end,
                    all_day: e.all_day,
                    location: e.location.clone(),
                    calendar: cal.title.clone(),
                });
            }
        }
    }
    out
}

fn fetch(agent: &ureq::Agent, url: &str) -> Result<Calendar, String> {
    parse_calendar(&news::get(agent, url)?, url)
}

static CACHE: news::Cache<Calendar> = LazyLock::new(Default::default);

/// Events from `urls` over the next [`AHEAD_DAYS`], soonest first.
pub fn upcoming(urls: &[String]) -> Events {
    let (cache, errors) = news::refresh(&CACHE, urls, fetch);
    let now = Utc::now().timestamp_millis();
    let mut events: Vec<Event> = urls
        .iter()
        .filter_map(|u| cache.get(u))
        .flat_map(|(cal, _)| expand(cal, now, now + AHEAD_DAYS * DAY_MS))
        .collect();
    events.sort_by(|a, b| (a.start, &a.title).cmp(&(b.start, &b.title)));
    events.truncate(MAX_EVENTS);
    let calendars = urls
        .iter()
        .map(|u| CalendarState {
            url: u.clone(),
            title: cache.get(u).map(|(c, _)| c.title.clone()),
            error: errors.get(u).cloned(),
        })
        .collect();
    Events { events, calendars }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(s: &str) -> i64 {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M")
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    fn local_day(s: &str) -> i64 {
        ms(
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .unwrap()
                .and_time(NaiveTime::MIN),
            Zone::Floating,
        )
    }

    const CAL: &str = "BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
X-WR-CALNAME:Work\r\n\
X-WR-TIMEZONE:Asia/Ho_Chi_Minh\r\n\
BEGIN:VEVENT\r\n\
UID:standup\r\n\
DTSTART;TZID=America/New_York:20261102T090000\r\n\
DTEND;TZID=America/New_York:20261102T091500\r\n\
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z\r\n\
EXDATE;TZID=America/New_York:20261111T090000\r\n\
SUMMARY:Stand\r\n  up\\, daily\r\n\
BEGIN:VALARM\r\n\
TRIGGER:-PT10M\r\n\
SUMMARY:Alarm\r\n\
END:VALARM\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:standup\r\n\
RECURRENCE-ID;TZID=America/New_York:20261116T090000\r\n\
DTSTART;TZID=America/New_York:20261116T100000\r\n\
DTEND;TZID=America/New_York:20261116T101500\r\n\
SUMMARY:Stand up (moved)\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:trip\r\n\
DTSTART;VALUE=DATE:20261120\r\n\
DTEND;VALUE=DATE:20261122\r\n\
SUMMARY:Trip\r\n\
LOCATION:Đà Lạt\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:lunch\r\n\
DTSTART:20261113T120000\r\n\
DURATION:PT1H\r\n\
SUMMARY:Lunch\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:gone\r\n\
DTSTART:20261113T120000Z\r\n\
STATUS:CANCELLED\r\n\
SUMMARY:Cancelled\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn reads_events_repeats_and_zones() {
        let cal = parse_calendar(CAL, "https://calendar.example/x.ics").unwrap();
        assert_eq!(cal.title, "Work");
        let mut events = expand(&cal, utc("2026-11-10 00:00"), utc("2026-11-24 00:00"));
        events.sort_by_key(|e| e.start);
        let list: Vec<(&str, i64)> = events.iter().map(|e| (e.title.as_str(), e.start)).collect();
        assert_eq!(
            list,
            vec![
                // Lunch has no zone, so the calendar's (UTC+7) applies.
                ("Lunch", utc("2026-11-13 05:00")),
                // 9:00 in New York is 14:00 UTC after the clocks went back on
                // Nov 1. Nov 11 is left out, and Nov 16 moved to 10:00.
                ("Stand up (moved)", utc("2026-11-16 15:00")),
                ("Stand up, daily", utc("2026-11-18 14:00")),
                ("Trip", local_day("2026-11-20")),
                ("Stand up, daily", utc("2026-11-23 14:00")),
            ]
        );
        let trip = events.iter().find(|e| e.title == "Trip").unwrap();
        assert!(trip.all_day);
        assert_eq!(trip.end, local_day("2026-11-22"));
        assert_eq!(trip.location.as_deref(), Some("Đà Lạt"));
        let lunch = events.iter().find(|e| e.title == "Lunch").unwrap();
        assert_eq!(lunch.end - lunch.start, 3_600_000);
    }

    #[test]
    fn follows_monthly_and_counted_repeats() {
        let body = "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\n\
UID:a\n\
DTSTART:20260105T100000Z\n\
RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3\n\
SUMMARY:Review\n\
END:VEVENT\n\
END:VCALENDAR\n";
        let cal = parse_calendar(body, "https://cal.example/a.ics").unwrap();
        assert_eq!(cal.title, "cal.example");
        let starts: Vec<i64> = expand(&cal, 0, utc("2027-01-01 00:00"))
            .iter()
            .map(|e| e.start)
            .collect();
        assert_eq!(
            starts,
            vec![
                utc("2026-01-30 10:00"),
                utc("2026-02-27 10:00"),
                utc("2026-03-27 10:00")
            ]
        );
    }

    #[test]
    fn refuses_pages_that_are_not_calendars() {
        assert!(parse_calendar("<html></html>", "https://x.example").is_err());
    }

    #[test]
    fn checks_calendar_links() {
        assert_eq!(
            normalize_calendar_url(" webcal://p01.icloud.com/x ").as_deref(),
            Some("https://p01.icloud.com/x")
        );
        assert_eq!(
            normalize_calendar_url("calendar.google.com/calendar/ical/a/basic.ics").as_deref(),
            Some("https://calendar.google.com/calendar/ical/a/basic.ics")
        );
        assert_eq!(normalize_calendar_url("file:///etc/passwd"), None);
    }
}
