//! Headlines for the News widget from the RSS or Atom feeds the user adds.
//! A link to an ordinary web page works too when the page names its feed.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::DateTime;
use serde::Serialize;

use super::market;

/// Most feeds a user can follow.
pub const MAX_FEEDS: usize = 8;
/// Most headlines sent to the widget, newest first.
const MAX_ITEMS: usize = 30;
/// Feeds rarely change faster; asking more often only costs the site.
const FRESH: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub title: String,
    pub link: String,
    /// The feed's name, or the site's host when it has none.
    pub source: String,
    /// Unix milliseconds, when the feed dates the item.
    pub published: Option<i64>,
    /// A short plain-text summary, when the feed has one.
    pub description: Option<String>,
    /// An `https` picture for the story, when the feed has one.
    pub image: Option<String>,
}

/// Longest summary kept, in characters.
const MAX_DESCRIPTION: usize = 280;

/// How one followed feed is doing, for Settings.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedState {
    pub url: String,
    pub title: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct News {
    pub items: Vec<NewsItem>,
    pub feeds: Vec<FeedState>,
}

#[derive(Clone, Debug, PartialEq)]
struct Feed {
    title: String,
    items: Vec<NewsItem>,
}

/// True for an `http://` or `https://` address without spaces.
pub fn is_web_link(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && url.len() > "https://".len()
        && !url.contains(char::is_whitespace)
}

/// Adds `https://` to a bare address; None when it still is not a web link.
pub fn normalize_feed_url(input: &str) -> Option<String> {
    let s = input.trim();
    // Another scheme, such as file://, is refused rather than prefixed.
    let url = if s.contains("://") {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    is_web_link(&url).then_some(url)
}

// shortcut: a small hand-written reader that handles the RSS 2.0, RSS 1.0 and
// Atom feeds news sites publish; switch to a feed crate if odd feeds show up.

/// Where `<tag …>` (not `<tagger>`) starts at or after `from`, and where its body starts.
fn open_tag(xml: &str, tag: &str, from: usize) -> Option<(usize, usize)> {
    let needle = format!("<{tag}");
    let mut at = from;
    while let Some(i) = xml[at..].find(&needle) {
        let start = at + i;
        let after = start + needle.len();
        match xml[after..].chars().next() {
            Some(c) if c == '>' || c == '/' || c.is_whitespace() => {
                let end = after + xml[after..].find('>')?;
                return Some((start, end + 1));
            }
            _ => at = after,
        }
    }
    None
}

/// The bodies of each `<tag>…</tag>` in `xml`, in order.
fn elements<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut at = 0;
    while let Some((_, body)) = open_tag(xml, tag, at) {
        let Some(len) = xml[body..].find(&close) else {
            break;
        };
        out.push(&xml[body..body + len]);
        at = body + len + close.len();
    }
    out
}

/// The first `<tag>` start tag text and its body (empty for `<tag/>`).
fn first<'a>(xml: &'a str, tag: &str) -> Option<(&'a str, &'a str)> {
    let (start, body) = open_tag(xml, tag, 0)?;
    let head = &xml[start..body];
    if head.ends_with("/>") {
        return Some((head, ""));
    }
    let len = xml[body..].find(&format!("</{tag}>"))?;
    Some((head, &xml[body..body + len]))
}

/// An attribute's value from a start tag, such as `href` from `<link href="…">`.
fn attr<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    for quote in ['"', '\''] {
        let needle = format!(" {name}={quote}");
        if let Some(i) = head.find(&needle) {
            let rest = &head[i + needle.len()..];
            return rest.find(quote).map(|j| &rest[..j]);
        }
    }
    None
}

/// Plain text from a feed field: CDATA unwrapped, tags dropped, entities decoded, spaces collapsed.
fn text(raw: &str) -> String {
    let raw = unwrap_html(raw);
    let raw = raw.as_str();
    let mut plain = String::with_capacity(raw.len());
    let mut in_tag = false;
    for c in raw.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => plain.push(c),
            _ => {}
        }
    }
    decode_entities(&plain)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A field's HTML: CDATA unwrapped, and decoded once when the feed escaped it (`&lt;p&gt;`).
fn unwrap_html(raw: &str) -> String {
    let raw = raw.trim();
    let raw = raw
        .strip_prefix("<![CDATA[")
        .and_then(|r| r.strip_suffix("]]>"))
        .unwrap_or(raw);
    if raw.contains("&lt;") {
        decode_entities(raw)
    } else {
        raw.to_string()
    }
}

/// The item's summary as plain text, cut at a word near [`MAX_DESCRIPTION`]; None when empty or just the headline.
fn description(entry: &str, headline: &str) -> Option<String> {
    let raw = ["description", "summary", "content:encoded", "content"]
        .iter()
        .find_map(|tag| {
            first(entry, tag)
                .map(|(_, b)| b)
                .filter(|b| !b.trim().is_empty())
        })?;
    let plain = text(raw);
    if plain.is_empty() || plain == headline {
        return None;
    }
    if plain.chars().count() <= MAX_DESCRIPTION {
        return Some(plain);
    }
    let cut: String = plain.chars().take(MAX_DESCRIPTION).collect();
    let cut = cut.rfind(' ').map_or(cut.as_str(), |i| &cut[..i]);
    Some(format!("{}…", cut.trim_end_matches([',', '.', ';', ':'])))
}

/// The item's picture: a media or enclosure tag, else the first `<img>` in its HTML.
fn image(entry: &str, base: &str) -> Option<String> {
    let tagged = ["media:content", "media:thumbnail", "enclosure"]
        .iter()
        .find_map(|tag| {
            elements_with_heads(entry, tag).find_map(|(head, _)| {
                let kind = attr(head, "type")
                    .or_else(|| attr(head, "medium"))
                    .unwrap_or("image");
                kind.starts_with("image")
                    .then(|| attr(head, "url"))
                    .flatten()
            })
        });
    let found = tagged.map(str::to_string).or_else(|| {
        ["description", "content:encoded", "summary", "content"]
            .iter()
            .find_map(|tag| {
                let html = unwrap_html(first(entry, tag)?.1);
                let (start, end) = open_tag(&html, "img", 0)?;
                attr(&html[start..end], "src").map(str::to_string)
            })
    })?;
    // The island only loads https pictures.
    let url = resolve(base, &found);
    url.to_ascii_lowercase()
        .starts_with("https://")
        .then_some(url)
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let decoded = rest.find(';').filter(|&j| j <= 10).and_then(|j| {
            let name = &rest[1..j];
            let c = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .map(|h| u32::from_str_radix(h, 16).ok())
                    .unwrap_or_else(|| name.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            };
            c.map(|c| (c, j))
        });
        match decoded {
            Some((c, j)) => {
                out.push(c);
                rest = &rest[j + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn parse_date(s: &str) -> Option<i64> {
    let s = text(s);
    DateTime::parse_from_rfc2822(&s)
        .or_else(|_| DateTime::parse_from_rfc3339(&s))
        .ok()
        .map(|d| d.timestamp_millis())
}

/// `scheme://host` of a web address.
fn origin(url: &str) -> &str {
    let after = url.find("://").map_or(0, |i| i + 3);
    url[after..].find('/').map_or(url, |i| &url[..after + i])
}

/// Makes a link from a page or feed absolute.
fn resolve(base: &str, href: &str) -> String {
    let href = decode_entities(href.trim());
    if is_web_link(&href) {
        href
    } else if let Some(rest) = href.strip_prefix("//") {
        let scheme = base.split("://").next().unwrap_or("https");
        format!("{scheme}://{rest}")
    } else if href.starts_with('/') {
        format!("{}{href}", origin(base))
    } else {
        let dir = base
            .rfind('/')
            .filter(|&i| i >= origin(base).len())
            .map_or(base, |i| &base[..i]);
        format!("{dir}/{href}")
    }
}

pub(crate) fn host(url: &str) -> String {
    let o = origin(url);
    o.split("://")
        .nth(1)
        .unwrap_or(o)
        .trim_start_matches("www.")
        .to_string()
}

fn is_feed(body: &str) -> bool {
    let head = &body[..body.len().min(2048)];
    head.contains("<rss") || head.contains("<feed") || head.contains("<rdf:RDF")
}

/// Reads an RSS or Atom document; `url` resolves relative links and names untitled feeds.
fn parse_feed(body: &str, url: &str) -> Result<Feed, String> {
    if !is_feed(body) {
        return Err("not an RSS or Atom feed".into());
    }
    let atom = elements(body, "entry");
    let entries = if atom.is_empty() {
        elements(body, "item")
    } else {
        atom
    };
    // The feed's own title comes before its first item.
    let head_end = open_tag(
        body,
        if body.contains("<entry") {
            "entry"
        } else {
            "item"
        },
        0,
    )
    .map_or(body.len(), |(s, _)| s);
    let title = first(&body[..head_end], "title")
        .map(|(_, t)| text(t))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| host(url));
    let items = entries
        .into_iter()
        .filter_map(|e| {
            let headline = text(first(e, "title")?.1);
            // RSS: <link>url</link>. Atom: <link rel="alternate" href="url"/>, often among others.
            let link = elements_with_heads(e, "link")
                .find_map(|(head, body)| match attr(head, "href") {
                    Some(href) if matches!(attr(head, "rel"), None | Some("alternate")) => {
                        Some(href.to_string())
                    }
                    Some(_) => None,
                    None => Some(text(body)),
                })
                .or_else(|| first(e, "guid").map(|(_, g)| text(g)))
                .map(|l| resolve(url, &l))
                .filter(|l| is_web_link(l))?;
            let published = ["pubDate", "published", "updated", "dc:date"]
                .iter()
                .find_map(|tag| first(e, tag).and_then(|(_, d)| parse_date(d)));
            let description = description(e, &headline);
            let image = image(e, url);
            (!headline.is_empty()).then(|| NewsItem {
                title: headline,
                link,
                source: title.clone(),
                published,
                description,
                image,
            })
        })
        .collect();
    Ok(Feed { title, items })
}

/// Every `<tag …>` start tag in `xml` with its body (empty when self-closing).
fn elements_with_heads<'a>(
    xml: &'a str,
    tag: &'a str,
) -> impl Iterator<Item = (&'a str, &'a str)> + 'a {
    let mut at = 0;
    std::iter::from_fn(move || {
        let (start, body) = open_tag(xml, tag, at)?;
        let head = &xml[start..body];
        if head.ends_with("/>") {
            at = body;
            return Some((head, ""));
        }
        let close = format!("</{tag}>");
        let len = xml[body..].find(&close).unwrap_or(0);
        at = body + len;
        Some((head, &xml[body..body + len]))
    })
}

/// The feed a web page names in `<link rel="alternate" type="application/rss+xml" href="…">`.
fn discover(html: &str, page: &str) -> Option<String> {
    elements_with_heads(html, "link").find_map(|(head, _)| {
        let kind = attr(head, "type")?;
        (kind.contains("rss+xml") || kind.contains("atom+xml"))
            .then(|| attr(head, "href").map(|h| resolve(page, h)))
            .flatten()
    })
}

pub(crate) fn get(agent: &ureq::Agent, url: &str) -> Result<String, String> {
    agent
        .get(url)
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())
}

/// Fetches a feed, following a web page to the feed it names.
fn fetch(agent: &ureq::Agent, url: &str) -> Result<Feed, String> {
    let body = get(agent, url)?;
    if is_feed(&body) {
        return parse_feed(&body, url);
    }
    let feed_url = discover(&body, url).ok_or("no news feed found at this address")?;
    parse_feed(&get(agent, &feed_url)?, &feed_url)
}

/// Each address's last result and when it was fetched.
pub(crate) type CacheMap<T> = HashMap<String, (T, Instant)>;
pub(crate) type Cache<T> = LazyLock<Mutex<CacheMap<T>>>;

static CACHE: Cache<Feed> = LazyLock::new(Default::default);

/// Fetches, in parallel, each address not fetched in the last [`FRESH`] and
/// keeps the results in `cache`. An address that fails keeps its last result.
/// Addresses no longer asked for are forgotten. Returns why each failed one failed.
pub(crate) fn refresh<'c, T: Send>(
    cache: &'c Cache<T>,
    urls: &[String],
    fetch: impl Fn(&ureq::Agent, &str) -> Result<T, String> + Sync,
) -> (MutexGuard<'c, CacheMap<T>>, HashMap<String, String>) {
    let stale: Vec<&String> = {
        let cache = cache.lock().unwrap_or_else(|e| e.into_inner());
        urls.iter()
            .filter(|u| cache.get(*u).is_none_or(|(_, at)| at.elapsed() >= FRESH))
            .collect()
    };
    let agent = market::agent();
    let fetch = &fetch;
    let fetched: Vec<(&String, Result<T, String>)> = std::thread::scope(|s| {
        let jobs: Vec<_> = stale
            .iter()
            .map(|u| (*u, s.spawn(|| fetch(&agent, u))))
            .collect();
        jobs.into_iter()
            .map(|(u, job)| {
                let result = job
                    .join()
                    .unwrap_or_else(|_| Err("reading the address failed".into()));
                (u, result)
            })
            .collect()
    });

    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    let mut errors = HashMap::new();
    for (url, result) in fetched {
        match result {
            Ok(value) => {
                cache.insert(url.clone(), (value, Instant::now()));
            }
            Err(e) => {
                // The host only: calendar links carry a private key in the path.
                log::warn!("{}: {e}", host(url));
                errors.insert(url.clone(), e);
            }
        }
    }
    cache.retain(|u, _| urls.contains(u));
    (cache, errors)
}

/// The latest headlines from `urls`, newest first.
pub fn latest(urls: &[String]) -> News {
    let (cache, errors) = refresh(&CACHE, urls, fetch);

    let mut items: Vec<NewsItem> = urls
        .iter()
        .filter_map(|u| cache.get(u))
        .flat_map(|(f, _)| f.items.iter().cloned())
        .collect();
    // Dated items newest first, then undated ones in feed order.
    items.sort_by_key(|i| std::cmp::Reverse(i.published.unwrap_or(i64::MIN)));
    items.truncate(MAX_ITEMS);
    let feeds = urls
        .iter()
        .map(|u| FeedState {
            url: u.clone(),
            title: cache.get(u).map(|(f, _)| f.title.clone()),
            error: errors.get(u).cloned(),
        })
        .collect();
    News { items, feeds }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RSS: &str = r#"<?xml version="1.0"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>Tin &amp; Tức</title>
  <atom:link href="https://ex.com/rss" rel="self"/>
  <item><title><![CDATA[First <b>story</b>]]></title><link>https://ex.com/a</link>
    <pubDate>Thu, 12 Nov 2026 08:00:00 +0700</pubDate>
    <description>&lt;a href="/a"&gt;&lt;img src="https://img.ex.com/a.jpg"&gt;&lt;/a&gt;&lt;/br&gt;Police say the &amp;quot;case&amp;quot; is closed.</description></item>
  <item><title>Second &#8220;quoted&#8221;</title><link>/b</link>
    <media:content url="http://img.ex.com/insecure.jpg" medium="image"/></item>
  <item><title>No link</title></item>
</channel></rss>"#;

    const ATOM: &str = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Atom Site</title>
  <entry><title>Entry</title>
    <link rel="self" href="https://ex.com/self"/><link rel="alternate" href="https://ex.com/e"/>
    <updated>2026-11-12T02:00:00Z</updated>
    <media:thumbnail url="https://ex.com/t.png"/>
    <summary>Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here. Long words here.</summary></entry>
</feed>"#;

    #[test]
    fn reads_rss() {
        let f = parse_feed(RSS, "https://ex.com/rss").unwrap();
        assert_eq!(f.title, "Tin & Tức");
        assert_eq!(f.items.len(), 2);
        assert_eq!(f.items[0].title, "First story");
        assert_eq!(f.items[0].published, Some(1_794_445_200_000));
        assert_eq!(f.items[1].title, "Second \u{201c}quoted\u{201d}");
        assert_eq!(f.items[1].link, "https://ex.com/b");
        assert_eq!(f.items[1].published, None);
        assert_eq!(
            f.items[0].image.as_deref(),
            Some("https://img.ex.com/a.jpg")
        );
        assert_eq!(
            f.items[0].description.as_deref(),
            Some("Police say the \"case\" is closed.")
        );
        assert_eq!(f.items[1].image, None, "http pictures are dropped");
        assert_eq!(f.items[1].description, None);
    }

    #[test]
    fn reads_atom() {
        let f = parse_feed(ATOM, "https://ex.com/atom").unwrap();
        assert_eq!(f.title, "Atom Site");
        assert_eq!(f.items[0].link, "https://ex.com/e");
        assert_eq!(f.items[0].published, Some(1_794_448_800_000));
        assert_eq!(f.items[0].image.as_deref(), Some("https://ex.com/t.png"));
        let d = f.items[0].description.as_deref().unwrap();
        assert!(
            d.ends_with("Long…") && d.chars().count() <= MAX_DESCRIPTION + 1,
            "{d}"
        );
    }

    #[test]
    fn finds_the_feed_a_page_names() {
        let html = r#"<html><head><link rel="stylesheet" href="/s.css">
          <link rel="alternate" type="application/rss+xml" title="News" href="/feed.xml"></head></html>"#;
        assert_eq!(
            discover(html, "https://ex.com/news/"),
            Some("https://ex.com/feed.xml".into())
        );
        assert_eq!(discover("<html></html>", "https://ex.com"), None);
        assert!(parse_feed(html, "https://ex.com").is_err());
    }

    #[test]
    fn checks_feed_addresses() {
        assert_eq!(
            normalize_feed_url(" vnexpress.net/rss "),
            Some("https://vnexpress.net/rss".into())
        );
        assert_eq!(normalize_feed_url("http://a.b"), Some("http://a.b".into()));
        assert_eq!(normalize_feed_url("a b"), None);
        assert_eq!(normalize_feed_url(""), None);
        assert_eq!(normalize_feed_url("file:///etc/passwd"), None);
        assert!(!is_web_link("file:///etc/passwd"));
        assert!(!is_web_link("javascript:alert(1)"));
    }

    /// Asks a real site; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_feed_loads() {
        let news = latest(&[
            "https://www.theverge.com".into(),
            "https://vnexpress.net/rss/tin-moi-nhat.rss".into(),
        ]);
        println!("{:#?}", news.feeds);
        assert!(!news.items.is_empty());
    }
}
