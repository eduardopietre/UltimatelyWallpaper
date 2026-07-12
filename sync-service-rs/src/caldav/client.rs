use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use icalendar::Calendar as IcalCalendar;
use regex::Regex;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use reqwest::Client;
use tracing::warn;
use url::Url;

use crate::cache::EventCache;
use crate::config::Config;
use crate::models::{CalendarInfo, EventInfo, SyncPayload};

use super::expand::{expand_vevents, normalize_occurrence, ParsedVEvent};

const ICLOUD_COLORS: &[&str] = &[
    "#E97777", "#7F669D", "#898AA6", "#967E76", "#71ad4b", "#3a588e", "#d27e06", "#0464ec",
    "#af4c4c", "#5482d6",
];

pub struct CalDavClient {
    http: Client,
    username: String,
    password: String,
    base_url: String,
    days_past: i64,
    days_future: i64,
}

#[derive(Debug, Clone)]
struct RemoteCalendar {
    url: String,
    id: String,
    name: String,
    color: String,
}

impl CalDavClient {
    pub fn new(cfg: &Config) -> Self {
        Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .redirect(reqwest::redirect::Policy::limited(10))
                .build()
                .expect("http client"),
            username: cfg.apple_id.clone(),
            password: cfg.app_password.clone(),
            base_url: cfg.caldav_url.clone(),
            days_past: cfg.days_past,
            days_future: cfg.days_future,
        }
    }

    fn auth_header(&self) -> HeaderValue {
        let token = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", self.username, self.password),
        );
        HeaderValue::from_str(&format!("Basic {token}")).expect("auth header")
    }

    fn headers(&self, content_type: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, self.auth_header());
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_str(content_type).unwrap_or_else(|_| HeaderValue::from_static("text/xml")),
        );
        headers
    }

    async fn propfind(&self, url: &str, depth: &str, body: &str) -> anyhow::Result<String> {
        let response = self
            .http
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url)
            .headers(self.headers("application/xml; charset=utf-8"))
            .header("Depth", depth)
            .body(body.to_string())
            .send()
            .await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() && status.as_u16() != 207 {
            anyhow::bail!("PROPFIND {url} failed: {status} {text}");
        }
        Ok(text)
    }

    async fn report(&self, url: &str, body: &str) -> anyhow::Result<String> {
        let response = self
            .http
            .request(reqwest::Method::from_bytes(b"REPORT").unwrap(), url)
            .headers(self.headers("application/xml; charset=utf-8"))
            .header("Depth", "1")
            .body(body.to_string())
            .send()
            .await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() && status.as_u16() != 207 {
            anyhow::bail!("REPORT {url} failed: {status} {text}");
        }
        Ok(text)
    }

    async fn put(&self, url: &str, ical: &str) -> anyhow::Result<String> {
        let response = self
            .http
            .put(url)
            .headers(self.headers("text/calendar; charset=utf-8"))
            .header("If-None-Match", "*")
            .body(ical.to_string())
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() && status.as_u16() != 201 && status.as_u16() != 204 {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("PUT {url} failed: {status} {text}");
        }
        Ok(url.to_string())
    }

    async fn put_overwrite(&self, url: &str, ical: &str) -> anyhow::Result<()> {
        let response = self
            .http
            .put(url)
            .headers(self.headers("text/calendar; charset=utf-8"))
            .body(ical.to_string())
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() && status.as_u16() != 201 && status.as_u16() != 204 {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("PUT overwrite {url} failed: {status} {text}");
        }
        Ok(())
    }

    async fn delete_url(&self, url: &str) -> anyhow::Result<()> {
        let response = self
            .http
            .delete(url)
            .header(AUTHORIZATION, self.auth_header())
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() && status.as_u16() != 204 && status.as_u16() != 404 {
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("DELETE {url} failed: {status} {text}");
        }
        Ok(())
    }

    async fn resolve_principal(&self) -> anyhow::Result<String> {
        let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>"#;
        let xml = self.propfind(&self.base_url, "0", body).await?;
        if let Some(href) = extract_tag_href(&xml, "current-user-principal") {
            let url = absolutize(&self.base_url, &href)?;
            tracing::info!("CalDAV principal: {url}");
            return Ok(url);
        }
        dump_debug_xml("principal", &xml);
        anyhow::bail!("current-user-principal not found")
    }

    async fn resolve_calendar_home(&self, principal: &str) -> anyhow::Result<String> {
        let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>"#;
        let xml = self.propfind(principal, "0", body).await?;
        if let Some(href) = extract_tag_href(&xml, "calendar-home-set") {
            let url = absolutize(principal, &href)?;
            tracing::info!("CalDAV calendar home: {url}");
            return Ok(url);
        }
        if resource_has_calendar_collection(&xml) {
            return Ok(principal.to_string());
        }
        dump_debug_xml("calendar-home", &xml);
        anyhow::bail!("calendar-home-set not found")
    }

    async fn list_calendars(&self, home: &str) -> anyhow::Result<Vec<RemoteCalendar>> {
        let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <ic:calendar-color/>
    <cs:getctag/>
  </d:prop>
</d:propfind>"#;
        let xml = self.propfind(home, "1", body).await?;
        let responses = split_responses(&xml);
        tracing::info!("Calendar home returned {} response blocks", responses.len());
        let mut calendars = Vec::new();
        let mut idx = 0usize;
        for resp in responses {
            if !resource_is_calendar(&resp) {
                continue;
            }
            let Some(href) = extract_first_href(&resp) else {
                continue;
            };
            let url = absolutize(home, &href)?;
            // Skip the home collection itself
            if url.trim_end_matches('/') == home.trim_end_matches('/') {
                continue;
            }
            let id = url.trim_end_matches('/').rsplit('/').next().unwrap_or("cal").to_string();
            let name = extract_tag_text(&resp, "displayname").unwrap_or_else(|| id.clone());
            let color = extract_calendar_color(&resp).unwrap_or_else(|| {
                ICLOUD_COLORS[idx % ICLOUD_COLORS.len()].to_string()
            });
            tracing::info!("Calendar discovered: {name} ({id})");
            calendars.push(RemoteCalendar {
                url,
                id,
                name,
                color,
            });
            idx += 1;
        }
        if calendars.is_empty() {
            dump_debug_xml("calendar-list", &xml);
        }
        Ok(calendars)
    }

    fn date_window(&self) -> (DateTime<Utc>, DateTime<Utc>) {
        let now = Utc::now();
        (now - Duration::days(self.days_past), now + Duration::days(self.days_future))
    }

    async fn fetch_calendar_events(
        &self,
        cal: &RemoteCalendar,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> anyhow::Result<Vec<EventInfo>> {
        let start_s = start.format("%Y%m%dT%H%M%SZ").to_string();
        let end_s = end.format("%Y%m%dT%H%M%SZ").to_string();
        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{start_s}" end="{end_s}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#
        );

        let xml = self.report(&cal.url, &body).await?;
        let mut vevents = Vec::new();
        let blocks = split_responses(&xml);
        for resp in &blocks {
            if let Some(data) = extract_calendar_data(resp) {
                let parsed = parse_vevents_from_ics(&data);
                vevents.extend(parsed);
            }
        }
        if vevents.is_empty() && xml.len() > 200 {
            dump_debug_xml(&format!("report-{}", sanitize_id(&cal.id)), &xml);
        }
        tracing::info!(
            "REPORT {} -> {} bytes, {} blocks, {} vevents",
            cal.name,
            xml.len(),
            blocks.len(),
            vevents.len()
        );

        let occurrences = expand_vevents(&vevents, start, end);
        let mut events = Vec::new();
        for (i, occ) in occurrences.into_iter().enumerate() {
            if let Some(ev) = normalize_occurrence(&occ, &cal.id, &cal.name, i, &cal.color) {
                events.push(ev);
            }
        }
        Ok(events)
    }

    pub async fn sync(&self) -> anyhow::Result<SyncPayload> {
        if self.username.is_empty() || self.password.is_empty() {
            anyhow::bail!("APPLE_ID and APP_PASSWORD must be set in .env");
        }
        let (start, end) = self.date_window();
        let principal = self.resolve_principal().await?;
        let home = self.resolve_calendar_home(&principal).await?;
        let calendars = self.list_calendars(&home).await?;
        tracing::info!("Found {} remote calendars", calendars.len());

        let mut calendar_infos = Vec::new();
        let mut events = Vec::new();
        for cal in &calendars {
            calendar_infos.push(CalendarInfo {
                id: cal.id.clone(),
                name: cal.name.clone(),
                color: cal.color.clone(),
            });
            match self.fetch_calendar_events(cal, start, end).await {
                Ok(list) => {
                    tracing::info!("Calendar {} -> {} events", cal.name, list.len());
                    events.extend(list);
                }
                Err(err) => warn!("Failed to fetch calendar {}: {err}", cal.name),
            }
        }
        events.sort_by(|a, b| a.start.cmp(&b.start));
        Ok(SyncPayload {
            updated_at: EventCache::utc_now_iso(),
            calendars: calendar_infos,
            events,
        })
    }

    async fn find_calendar(&self, calendar_id: &str) -> anyhow::Result<RemoteCalendar> {
        let principal = self.resolve_principal().await?;
        let home = self.resolve_calendar_home(&principal).await?;
        let calendars = self.list_calendars(&home).await?;
        calendars
            .into_iter()
            .find(|c| c.id == calendar_id)
            .ok_or_else(|| anyhow::anyhow!("Calendar not found: {calendar_id}"))
    }

    async fn find_event_href(
        &self,
        cal: &RemoteCalendar,
        uid: &str,
        prefer_exception: bool,
    ) -> anyhow::Result<Option<(String, String)>> {
        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:prop-filter name="UID">
          <c:text-match>{uid}</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#,
            uid = xml_escape(uid)
        );
        let xml = self.report(&cal.url, &body).await?;
        let mut first: Option<(String, String)> = None;
        for resp in split_responses(&xml) {
            let Some(href) = extract_first_href(&resp) else {
                continue;
            };
            let Some(data) = extract_calendar_data(&resp) else {
                continue;
            };
            let url = absolutize(&cal.url, &href)?;
            if prefer_exception && data.to_uppercase().contains("RECURRENCE-ID") {
                return Ok(Some((url, data)));
            }
            if first.is_none() {
                first = Some((url, data));
            }
        }
        Ok(first)
    }

    pub async fn create_event(&self, calendar_id: &str, ical_data: &str) -> anyhow::Result<serde_json::Value> {
        let cal = self.find_calendar(calendar_id).await?;
        let uid = extract_uid_from_ics(ical_data).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let href = format!("{}{}.ics", ensure_trailing_slash(&cal.url), uid);
        let url = self.put(&href, ical_data).await?;
        Ok(serde_json::json!({
            "calendarId": calendar_id,
            "url": url,
        }))
    }

    pub async fn update_event(
        &self,
        calendar_id: &str,
        uid: &str,
        ical_data: &str,
        recurrence_id: Option<&str>,
        scope: &str,
    ) -> anyhow::Result<serde_json::Value> {
        let cal = self.find_calendar(calendar_id).await?;
        if scope == "this" && recurrence_id.map(|s| !s.is_empty()).unwrap_or(false) {
            let new_uid = extract_uid_from_ics(ical_data).unwrap_or_else(|| uid.to_string());
            let href = format!(
                "{}{}-{}.ics",
                ensure_trailing_slash(&cal.url),
                new_uid,
                uuid::Uuid::new_v4()
            );
            self.put(&href, ical_data).await?;
            return Ok(serde_json::json!({
                "calendarId": calendar_id,
                "scope": "this",
            }));
        }

        let found = self
            .find_event_href(&cal, uid, scope == "this")
            .await?
            .ok_or_else(|| anyhow::anyhow!("Event not found: {uid}"))?;
        self.put_overwrite(&found.0, ical_data).await?;
        Ok(serde_json::json!({
            "calendarId": calendar_id,
            "uid": uid,
            "url": found.0,
        }))
    }

    pub async fn delete_event(
        &self,
        calendar_id: &str,
        uid: &str,
        recurrence_id: Option<&str>,
        scope: &str,
    ) -> anyhow::Result<serde_json::Value> {
        let cal = self.find_calendar(calendar_id).await?;
        let found = self
            .find_event_href(&cal, uid, scope == "this" && recurrence_id.is_some())
            .await?
            .ok_or_else(|| anyhow::anyhow!("Event not found: {uid}"))?;

        if scope == "this" && recurrence_id.map(|s| !s.is_empty()).unwrap_or(false) {
            let stripped = strip_first_recurrence_id_vevent(&found.1);
            self.put_overwrite(&found.0, &stripped).await?;
            return Ok(serde_json::json!({
                "calendarId": calendar_id,
                "uid": uid,
                "scope": "this",
            }));
        }

        self.delete_url(&found.0).await?;
        Ok(serde_json::json!({
            "calendarId": calendar_id,
            "uid": uid,
            "scope": scope,
        }))
    }
}

pub async fn run_sync(cache: &EventCache, cfg: &Config) -> anyhow::Result<SyncPayload> {
    let client = CalDavClient::new(cfg);
    let payload = client.sync().await?;
    cache.write(&payload)?;
    tracing::info!(
        "Synced {} events from {} calendars",
        payload.events.len(),
        payload.calendars.len()
    );
    Ok(payload)
}

pub async fn create_event(cfg: &Config, calendar_id: &str, ical_data: &str) -> anyhow::Result<serde_json::Value> {
    CalDavClient::new(cfg).create_event(calendar_id, ical_data).await
}

pub async fn update_event(
    cfg: &Config,
    calendar_id: &str,
    uid: &str,
    ical_data: &str,
    recurrence_id: Option<&str>,
    scope: &str,
) -> anyhow::Result<serde_json::Value> {
    CalDavClient::new(cfg)
        .update_event(calendar_id, uid, ical_data, recurrence_id, scope)
        .await
}

pub async fn delete_event(
    cfg: &Config,
    calendar_id: &str,
    uid: &str,
    recurrence_id: Option<&str>,
    scope: &str,
) -> anyhow::Result<serde_json::Value> {
    CalDavClient::new(cfg)
        .delete_event(calendar_id, uid, recurrence_id, scope)
        .await
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .take(40)
        .collect()
}

fn dump_debug_xml(name: &str, xml: &str) {
    let dir = std::path::Path::new("logs");
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(format!("caldav-{name}.xml"));
    if let Err(err) = std::fs::write(&path, xml) {
        tracing::warn!("Failed to write {}: {err}", path.display());
    } else {
        tracing::error!(
            "CalDAV debug XML written to {} ({} bytes)",
            path.display(),
            xml.len()
        );
    }
}

fn ensure_trailing_slash(url: &str) -> String {
    if url.ends_with('/') {
        url.to_string()
    } else {
        format!("{url}/")
    }
}

fn absolutize(base: &str, href: &str) -> anyhow::Result<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        return Ok(href.to_string());
    }
    let base_url = Url::parse(base)?;
    Ok(base_url.join(href)?.to_string())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn split_responses(xml: &str) -> Vec<String> {
    let Ok(re) = Regex::new(r"(?is)<(?:[\w.-]+:)?response\b[^>]*>.*?</(?:[\w.-]+:)?response\s*>") else {
        return Vec::new();
    };
    re.find_iter(xml).map(|m| m.as_str().to_string()).collect()
}

fn resource_is_calendar(resp: &str) -> bool {
    let lower = resp.to_ascii_lowercase();
    if lower.contains("calendar-proxy")
        || lower.contains("schedule-inbox")
        || lower.contains("schedule-outbox")
        || lower.contains("notification")
    {
        return false;
    }
    // Accept any calendar component inside resourcetype
    let Ok(re) = Regex::new(r"(?is)<(?:[\w.-]+:)?resourcetype\b[^>]*>.*?</(?:[\w.-]+:)?resourcetype\s*>") else {
        return false;
    };
    let Some(m) = re.find(&lower) else {
        return false;
    };
    let section = m.as_str();
    Regex::new(r"(?i)<(?:[\w.-]+:)?calendar\b")
        .ok()
        .map(|cal| cal.is_match(section))
        .unwrap_or(false)
}

fn extract_first_href(block: &str) -> Option<String> {
    let re = Regex::new(r"(?is)<(?:[\w.-]+:)?href[^>]*>(.*?)</(?:[\w.-]+:)?href\s*>").ok()?;
    let caps = re.captures(block)?;
    Some(decode_xml_entities(&caps[1].trim().to_string()))
}

fn extract_tag_href(xml: &str, tag: &str) -> Option<String> {
    let tag_l = regex::escape(&tag.to_ascii_lowercase());
    let re = Regex::new(&format!(
        r"(?is)<(?:[\w.-]+:)?{tag_l}\b[^>]*>(.*?)</(?:[\w.-]+:)?{tag_l}\s*>"
    ))
    .ok()?;
    let caps = re.captures(xml)?;
    extract_first_href(&caps[1])
}

fn extract_tag_text(block: &str, tag: &str) -> Option<String> {
    let tag_l = regex::escape(&tag.to_ascii_lowercase());
    let re = Regex::new(&format!(
        r"(?is)<(?:[\w.-]+:)?{tag_l}\b[^>]*>(.*?)</(?:[\w.-]+:)?{tag_l}\s*>"
    ))
    .ok()?;
    let caps = re.captures(block)?;
    let inner = caps[1].trim();
    let text = inner.split('<').next().unwrap_or(inner).trim();
    if text.is_empty() {
        None
    } else {
        Some(decode_xml_entities(&text.to_string()))
    }
}

fn extract_between_ci(hay: &str, open: &str, close: &str) -> Option<String> {
    let lower = hay.to_ascii_lowercase();
    let open_l = open.to_ascii_lowercase();
    let close_l = close.to_ascii_lowercase();
    let start = lower.find(&open_l)? + open_l.len();
    let end = lower[start..].find(&close_l)? + start;
    Some(hay[start..end].to_string())
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn resource_has_calendar_collection(xml: &str) -> bool {
    split_responses(xml).iter().any(|r| resource_is_calendar(r))
}

fn extract_calendar_color(resp: &str) -> Option<String> {
    let re_tag = Regex::new(
        r"(?is)<(?:[\w.-]+:)?calendar-color\b[^>]*>(.*?)</(?:[\w.-]+:)?calendar-color\s*>",
    )
    .ok()?;
    let color = decode_xml_entities(&re_tag.captures(resp)?[1].trim().to_string());
    let re = Regex::new(r"^#[0-9A-Fa-f]{6}$").ok()?;
    if re.is_match(&color) {
        Some(color)
    } else {
        // Sometimes Apple returns #RRGGBBAA
        if color.len() >= 7 && re.is_match(&color[..7]) {
            Some(color[..7].to_string())
        } else {
            None
        }
    }
}

fn extract_calendar_data(resp: &str) -> Option<String> {
    let lower = resp.to_ascii_lowercase();
    let start_token = "calendar-data";
    let start = lower.find(start_token)?;
    let after_name = start + start_token.len();
    let gt = lower[after_name..].find('>')? + after_name + 1;
    // self-closing
    if resp[start..gt].contains("/>") {
        return None;
    }
    let end_token = "calendar-data>";
    let end_rel = lower[gt..].find(end_token)?;
    // walk back to '<'
    let close_bracket = lower[..gt + end_rel].rfind('<')?;
    let content = &resp[gt..close_bracket];
    Some(decode_xml_entities(&content.to_string()))
}

fn extract_uid_from_ics(ics: &str) -> Option<String> {
    for line in ics.lines() {
        if let Some(rest) = line.strip_prefix("UID:") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

fn parse_vevents_from_ics(ics: &str) -> Vec<ParsedVEvent> {
    let cleaned = ics
        .replace("&#13;", "\r")
        .replace("&#10;", "\n")
        .replace("\r\n", "\n");
    if let Ok(cal) = cleaned.parse::<IcalCalendar>() {
        let mut out = Vec::new();
        for component in cal.components {
            if let icalendar::CalendarComponent::Event(event) = component {
                out.push(ParsedVEvent::from_ical_event(&event));
            }
        }
        if !out.is_empty() {
            return out;
        }
    }
    parse_vevents_manual(&cleaned)
}

fn parse_vevents_manual(ics: &str) -> Vec<ParsedVEvent> {
    let mut out = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    // Unfold ICS lines
    for raw in ics.lines() {
        if raw.starts_with(' ') || raw.starts_with('\t') {
            if let Some(last) = lines.last_mut() {
                last.push_str(raw.trim_start());
            }
        } else {
            lines.push(raw.to_string());
        }
    }

    let mut i = 0;
    while i < lines.len() {
        if !lines[i].eq_ignore_ascii_case("BEGIN:VEVENT") {
            i += 1;
            continue;
        }
        i += 1;
        let mut props: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        while i < lines.len() && !lines[i].eq_ignore_ascii_case("END:VEVENT") {
            if let Some((name, value)) = lines[i].split_once(':') {
                let key = name.split(';').next().unwrap_or(name).to_ascii_uppercase();
                props.insert(key, value.to_string());
            }
            i += 1;
        }
        if let Some(event) = parsed_from_props(&props) {
            out.push(event);
        }
        i += 1;
    }
    out
}

fn parsed_from_props(props: &std::collections::HashMap<String, String>) -> Option<ParsedVEvent> {
    let dtstart_raw = props.get("DTSTART")?;
    let (all_day, dtstart) = parse_ical_datetime_pub(dtstart_raw)?;
    let dtend = props
        .get("DTEND")
        .and_then(|v| parse_ical_datetime_pub(v).map(|(_, d)| d));
    let recurrence_id = props
        .get("RECURRENCE-ID")
        .and_then(|v| parse_ical_datetime_pub(v).map(|(_, d)| d));
    Some(ParsedVEvent {
        uid: props
            .get("UID")
            .cloned()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        summary: props
            .get("SUMMARY")
            .cloned()
            .unwrap_or_else(|| "Untitled".into()),
        location: props.get("LOCATION").cloned().unwrap_or_default(),
        description: props.get("DESCRIPTION").cloned().unwrap_or_default(),
        url: props.get("URL").cloned().unwrap_or_default(),
        all_day,
        dtstart,
        dtend,
        rrule: props.get("RRULE").cloned(),
        recurrence_id,
        exdates: Vec::new(),
    })
}

fn parse_ical_datetime_pub(value: &str) -> Option<(bool, DateTime<Utc>)> {
    let value = value.trim();
    // Strip TZID=...: prefix if present in raw property form "TZID=X:YYYYMMDD..."
    let value = value.rsplit(':').next().unwrap_or(value).trim();

    let force_date = !value.contains('T') && value.chars().filter(|c| c.is_ascii_digit()).count() >= 8;
    if force_date {
        let digits: String = value.chars().filter(|c| c.is_ascii_digit()).take(8).collect();
        let date = chrono::NaiveDate::parse_from_str(&digits, "%Y%m%d").ok()?;
        let dt = Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0)?);
        return Some((true, dt));
    }

    let compact: String = value
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == 'T' || *c == 'Z')
        .collect();

    if compact.len() >= 15 {
        let naive = chrono::NaiveDateTime::parse_from_str(&compact[..15], "%Y%m%dT%H%M%S").ok()?;
        if compact.ends_with('Z') {
            return Some((false, DateTime::from_naive_utc_and_offset(naive, Utc)));
        }
        // Floating / TZID local times: interpret as local wall time
        if let Some(local) = chrono::Local.from_local_datetime(&naive).single() {
            return Some((false, local.with_timezone(&Utc)));
        }
        return Some((false, DateTime::from_naive_utc_and_offset(naive, Utc)));
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(&value.replace('Z', "+00:00")) {
        return Some((false, dt.with_timezone(&Utc)));
    }
    None
}

fn strip_first_recurrence_id_vevent(ics: &str) -> String {
    // Simple line-based strip of first VEVENT that contains RECURRENCE-ID
    let mut lines: Vec<&str> = ics.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim().eq_ignore_ascii_case("BEGIN:VEVENT") {
            let start = i;
            let mut end = i + 1;
            let mut has_rid = false;
            while end < lines.len() && !lines[end].trim().eq_ignore_ascii_case("END:VEVENT") {
                if lines[end].to_ascii_uppercase().starts_with("RECURRENCE-ID") {
                    has_rid = true;
                }
                end += 1;
            }
            if end < lines.len() {
                end += 1; // include END:VEVENT
            }
            if has_rid {
                lines.drain(start..end);
                break;
            }
            i = end;
        } else {
            i += 1;
        }
    }
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

#[allow(dead_code)]
fn naive_date_to_utc(date: NaiveDate) -> DateTime<Utc> {
    Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
}

#[allow(dead_code)]
fn _unused_datelike(d: NaiveDate) -> u32 {
    d.day()
}
