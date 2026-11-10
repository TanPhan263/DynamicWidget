//! Weather for the Weather widget, from wttr.in: no key, and it finds the
//! place from the computer's IP address.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::market;
use crate::errors::{AppError, AppResult};

// shortcut: the place comes from the IP address, so a VPN shows its city;
// add a city setting if people ask.
const URL: &str = "https://wttr.in/?format=j1";
/// wttr.in updates about every 15 minutes; asking more often only costs it.
const FRESH: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub place: String,
    pub temp_c: f64,
    pub feels_like_c: f64,
    /// wttr.in's (WWO) condition code; the page picks an icon from it.
    pub code: u32,
    pub description: String,
    pub days: Vec<Day>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    /// `YYYY-MM-DD` in the place's time zone.
    pub date: String,
    pub high_c: f64,
    pub low_c: f64,
    /// The condition at midday.
    pub code: u32,
}

#[derive(Deserialize)]
struct Text {
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Current {
    #[serde(rename = "temp_C")]
    temp_c: String,
    #[serde(rename = "FeelsLikeC")]
    feels_like_c: String,
    weather_code: String,
    weather_desc: Vec<Text>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Area {
    area_name: Vec<Text>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hour {
    time: String,
    weather_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WttrDay {
    date: String,
    #[serde(rename = "maxtempC")]
    max: String,
    #[serde(rename = "mintempC")]
    min: String,
    hourly: Vec<Hour>,
}

#[derive(Deserialize)]
struct Wttr {
    current_condition: Vec<Current>,
    nearest_area: Vec<Area>,
    weather: Vec<WttrDay>,
}

fn num(s: &str) -> Result<f64, String> {
    s.trim().parse().map_err(|_| format!("not a number: {s:?}"))
}

fn first(list: &[Text]) -> String {
    list.first()
        .map(|t| t.value.trim().to_string())
        .unwrap_or_default()
}

/// wttr.in's own code for a language, where it differs from ours.
fn wttr_lang(lang: &str) -> &str {
    if lang == "zh" {
        "zh-cn"
    } else {
        lang
    }
}

/// `lang` other than English also reads wttr.in's translated description.
pub fn parse(body: &str, lang: &str) -> Result<Weather, String> {
    let w: Wttr = serde_json::from_str(body).map_err(|e| format!("unexpected response: {e}"))?;
    // With `lang=xx`, each condition also carries `"lang_xx": [{"value": …}]`.
    let translated = (lang != "en")
        .then(|| serde_json::from_str::<serde_json::Value>(body).ok())
        .flatten()
        .and_then(|v| {
            v["current_condition"][0][format!("lang_{}", wttr_lang(lang))][0]["value"]
                .as_str()
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());
    let now = w.current_condition.first().ok_or("no current weather")?;
    let days = w
        .weather
        .iter()
        .map(|d| {
            // Hours are "0", "300" … "2100"; midday says the most about a day.
            let code = d
                .hourly
                .iter()
                .find(|h| h.time == "1200")
                .or(d.hourly.first())
                .map(|h| num(&h.weather_code))
                .transpose()?
                .unwrap_or(0.0);
            Ok(Day {
                date: d.date.clone(),
                high_c: num(&d.max)?,
                low_c: num(&d.min)?,
                code: code as u32,
            })
        })
        .collect::<Result<_, String>>()?;
    Ok(Weather {
        place: w
            .nearest_area
            .first()
            .map(|a| first(&a.area_name))
            .unwrap_or_default(),
        temp_c: num(&now.temp_c)?,
        feels_like_c: num(&now.feels_like_c)?,
        code: num(&now.weather_code)? as u32,
        description: translated.unwrap_or_else(|| first(&now.weather_desc)),
        days,
    })
}

static CACHE: Mutex<Option<(Weather, Instant, &'static str)>> = Mutex::new(None);

/// The current weather in `lang`, fetched at most once every 15 minutes
/// (or when the language changes). Blocks.
pub fn current(lang: &'static str) -> AppResult<Weather> {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((w, at, cached_lang)) = cache.as_ref() {
        if at.elapsed() < FRESH && *cached_lang == lang {
            return Ok(w.clone());
        }
    }
    let url = if lang == "en" {
        URL.to_string()
    } else {
        format!("{URL}&lang={}", wttr_lang(lang))
    };
    let fetched = market::agent()
        .get(&url)
        .call()
        .map_err(|e| e.to_string())
        .and_then(|r| r.into_string().map_err(|e| e.to_string()))
        .and_then(|body| parse(&body, lang));
    match fetched {
        Ok(w) => {
            *cache = Some((w.clone(), Instant::now(), lang));
            Ok(w)
        }
        Err(e) => {
            log::warn!("weather: {e}");
            // An older reading beats none while offline.
            cache
                .as_ref()
                .map(|(w, _, _)| w.clone())
                .ok_or_else(|| AppError::Platform(format!("weather unavailable: {e}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "current_condition": [{"temp_C": "30", "FeelsLikeC": "34", "weatherCode": "176",
        "weatherDesc": [{"value": "Patchy rain nearby"}], "lang_vi": [{"value": "Có mưa rải rác gần đó"}],
        "humidity": "65"}],
      "nearest_area": [{"areaName": [{"value": "An Phu Dong"}], "country": [{"value": "Vietnam"}]}],
      "weather": [
        {"date": "2026-11-10", "maxtempC": "32", "mintempC": "24",
         "hourly": [{"time": "0", "weatherCode": "113"}, {"time": "1200", "weatherCode": "302"}]},
        {"date": "2026-11-11", "maxtempC": "31", "mintempC": "25",
         "hourly": [{"time": "0", "weatherCode": "116"}]}
      ]
    }"#;

    #[test]
    fn reads_wttr() {
        let w = parse(SAMPLE, "en").unwrap();
        assert_eq!(w.place, "An Phu Dong");
        assert_eq!((w.temp_c, w.feels_like_c, w.code), (30.0, 34.0, 176));
        assert_eq!(w.description, "Patchy rain nearby");
        assert_eq!(w.days.len(), 2);
        assert_eq!(w.days[0].code, 302, "midday");
        assert_eq!(w.days[1].code, 116, "first hour without a midday one");
        assert_eq!((w.days[0].high_c, w.days[0].low_c), (32.0, 24.0));
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse("Unknown location", "en").is_err());
        assert!(parse(
            r#"{"current_condition": [], "nearest_area": [], "weather": []}"#,
            "en"
        )
        .is_err());
    }

    #[test]
    fn reads_the_translated_description_when_there_is_one() {
        assert_eq!(
            parse(SAMPLE, "vi").unwrap().description,
            "Có mưa rải rác gần đó"
        );
        // No Japanese in the sample: English stands in.
        assert_eq!(
            parse(SAMPLE, "ja").unwrap().description,
            "Patchy rain nearby"
        );
    }

    /// Asks wttr.in for real; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn live_weather_loads() {
        let w = current("vi").unwrap();
        assert!(!w.days.is_empty());
        println!("{w:?}");
    }
}
