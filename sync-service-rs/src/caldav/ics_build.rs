use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use uuid::Uuid;

use crate::models::{CreateEventRequest, UpdateEventRequest};

const REPEAT_RRULE: &[(&str, &str)] = &[
    ("daily", "FREQ=DAILY"),
    ("weekly", "FREQ=WEEKLY"),
    ("biweekly", "FREQ=WEEKLY;INTERVAL=2"),
    ("monthly", "FREQ=MONTHLY"),
    ("yearly", "FREQ=YEARLY"),
];

const ALERT_TRIGGER: &[(&str, &str)] = &[
    ("at_time", "PT0S"),
    ("5m", "-PT5M"),
    ("10m", "-PT10M"),
    ("15m", "-PT15M"),
    ("30m", "-PT30M"),
    ("1h", "-PT1H"),
    ("2h", "-PT2H"),
    ("1d", "-P1D"),
    ("2d", "-P2D"),
    ("1w", "-P1W"),
];

pub trait EventPayload {
    fn title(&self) -> &str;
    fn location(&self) -> &str;
    fn all_day(&self) -> bool;
    fn start(&self) -> &str;
    fn end(&self) -> &str;
    fn repeat(&self) -> &str;
    fn alert(&self) -> &str;
    fn url(&self) -> &str;
    fn notes(&self) -> &str;
}

impl EventPayload for CreateEventRequest {
    fn title(&self) -> &str {
        &self.title
    }
    fn location(&self) -> &str {
        &self.location
    }
    fn all_day(&self) -> bool {
        self.all_day
    }
    fn start(&self) -> &str {
        &self.start
    }
    fn end(&self) -> &str {
        &self.end
    }
    fn repeat(&self) -> &str {
        &self.repeat
    }
    fn alert(&self) -> &str {
        &self.alert
    }
    fn url(&self) -> &str {
        &self.url
    }
    fn notes(&self) -> &str {
        &self.notes
    }
}

impl EventPayload for UpdateEventRequest {
    fn title(&self) -> &str {
        &self.title
    }
    fn location(&self) -> &str {
        &self.location
    }
    fn all_day(&self) -> bool {
        self.all_day
    }
    fn start(&self) -> &str {
        &self.start
    }
    fn end(&self) -> &str {
        &self.end
    }
    fn repeat(&self) -> &str {
        &self.repeat
    }
    fn alert(&self) -> &str {
        &self.alert
    }
    fn url(&self) -> &str {
        &self.url
    }
    fn notes(&self) -> &str {
        &self.notes
    }
}

pub fn validate_event_payload(payload: &dyn EventPayload) -> Result<(), String> {
    if payload.title().trim().is_empty() {
        return Err("Title is required".into());
    }
    let start = parse_datetime(payload.start(), payload.all_day(), false)?;
    let end = parse_datetime(payload.end(), payload.all_day(), true)?;
    match (start, end) {
        (DateOrDateTime::Date(s), DateOrDateTime::Date(e)) => {
            if e < s {
                return Err("End date must be on or after start date".into());
            }
        }
        (DateOrDateTime::DateTime(s), DateOrDateTime::DateTime(e)) => {
            if e <= s {
                return Err("End time must be after start time".into());
            }
        }
        _ => {}
    }
    Ok(())
}

enum DateOrDateTime {
    Date(NaiveDate),
    DateTime(DateTime<Utc>),
}

fn parse_datetime(value: &str, all_day: bool, _is_end: bool) -> Result<DateOrDateTime, String> {
    if all_day {
        let date = NaiveDate::parse_from_str(&value[..10.min(value.len())], "%Y-%m-%d")
            .map_err(|_| "Invalid date".to_string())?;
        return Ok(DateOrDateTime::Date(date));
    }
    let normalized = value.replace('Z', "+00:00");
    let dt = DateTime::parse_from_rfc3339(&normalized).or_else(|_| {
        let naive = chrono::NaiveDateTime::parse_from_str(
            &normalized.replace('T', " ")[..19.min(normalized.len())],
            "%Y-%m-%d %H:%M:%S",
        )
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(
                &normalized[..19.min(normalized.len())],
                "%Y-%m-%dT%H:%M:%S",
            )
        })
        .map_err(|_| "Invalid datetime".to_string())?;
        let local = chrono::Local
            .from_local_datetime(&naive)
            .single()
            .ok_or_else(|| "Invalid datetime".to_string())?;
        Ok::<_, String>(local.fixed_offset())
    })?;
    Ok(DateOrDateTime::DateTime(dt.with_timezone(&Utc)))
}

pub fn build_vevent_ical(
    payload: &dyn EventPayload,
    uid: Option<&str>,
    recurrence_id: Option<&str>,
) -> Result<String, String> {
    validate_event_payload(payload)?;
    let title = payload.title().trim();
    let uid = uid.map(|s| s.to_string()).unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().format("%Y%m%dT%H%M%SZ");

    let mut lines = vec![
        "BEGIN:VCALENDAR".into(),
        "PRODID:-//ultimately-wallpaper//sync-service//EN".into(),
        "VERSION:2.0".into(),
        "BEGIN:VEVENT".into(),
        format!("UID:{uid}"),
        format!("DTSTAMP:{now}"),
        format!("SUMMARY:{}", escape_text(title)),
    ];

    if let Some(rid) = recurrence_id.filter(|s| !s.is_empty()) {
        if payload.all_day() {
            let date = &rid[..10.min(rid.len())].replace('-', "");
            lines.push(format!("RECURRENCE-ID;VALUE=DATE:{date}"));
        } else {
            let dt = parse_datetime(rid, false, false)?;
            if let DateOrDateTime::DateTime(dt) = dt {
                lines.push(format!(
                    "RECURRENCE-ID:{}",
                    dt.format("%Y%m%dT%H%M%SZ")
                ));
            }
        }
    }

    if !payload.location().is_empty() {
        lines.push(format!("LOCATION:{}", escape_text(payload.location())));
    }
    if !payload.url().is_empty() {
        lines.push(format!("URL:{}", payload.url()));
    }
    if !payload.notes().is_empty() {
        lines.push(format!("DESCRIPTION:{}", escape_text(payload.notes())));
    }

    let start = parse_datetime(payload.start(), payload.all_day(), false)?;
    let mut end = parse_datetime(payload.end(), payload.all_day(), true)?;

    match (&start, &mut end) {
        (DateOrDateTime::Date(s), DateOrDateTime::Date(e)) => {
            let mut end_date = *e;
            if end_date <= *s {
                end_date = *s + Duration::days(1);
            }
            lines.push(format!(
                "DTSTART;VALUE=DATE:{}",
                s.format("%Y%m%d")
            ));
            lines.push(format!(
                "DTEND;VALUE=DATE:{}",
                end_date.format("%Y%m%d")
            ));
        }
        (DateOrDateTime::DateTime(s), DateOrDateTime::DateTime(e)) => {
            lines.push(format!("DTSTART:{}", s.format("%Y%m%dT%H%M%SZ")));
            lines.push(format!("DTEND:{}", e.format("%Y%m%dT%H%M%SZ")));
        }
        _ => return Err("Invalid start/end combination".into()),
    }

    if payload.repeat() != "never" {
        if let Some((_, rule)) = REPEAT_RRULE.iter().find(|(k, _)| *k == payload.repeat()) {
            lines.push(format!("RRULE:{rule}"));
        }
    }

    if payload.alert() != "none" {
        if let Some((_, trigger)) = ALERT_TRIGGER.iter().find(|(k, _)| *k == payload.alert()) {
            lines.push("BEGIN:VALARM".into());
            lines.push("ACTION:DISPLAY".into());
            lines.push(format!("DESCRIPTION:{}", escape_text(title)));
            lines.push(format!("TRIGGER:{trigger}"));
            lines.push("END:VALARM".into());
        }
    }

    lines.push("END:VEVENT".into());
    lines.push("END:VCALENDAR".into());
    Ok(lines.join("\r\n") + "\r\n")
}

fn escape_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}
