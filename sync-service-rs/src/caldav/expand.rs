use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use icalendar::{Component, Event as IcalEvent, EventLike};
use rrule::{RRule, RRuleSet, Tz};

use crate::models::EventInfo;

#[derive(Debug, Clone)]
pub struct ParsedVEvent {
    pub uid: String,
    pub summary: String,
    pub location: String,
    pub description: String,
    pub url: String,
    pub all_day: bool,
    pub dtstart: DateTime<Utc>,
    pub dtend: Option<DateTime<Utc>>,
    pub rrule: Option<String>,
    pub recurrence_id: Option<DateTime<Utc>>,
    pub exdates: Vec<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct Occurrence {
    pub uid: String,
    pub summary: String,
    pub location: String,
    pub description: String,
    pub url: String,
    pub all_day: bool,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub is_recurring: bool,
    pub recurrence_id: Option<DateTime<Utc>>,
    pub has_rrule: bool,
}

impl ParsedVEvent {
    pub fn from_ical_event(event: &IcalEvent) -> Self {
        let uid = event
            .get_uid()
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let summary = event
            .get_summary()
            .unwrap_or("Untitled")
            .trim()
            .to_string();
        let location = event.get_location().unwrap_or("").to_string();
        let description = event.get_description().unwrap_or("").trim().to_string();
        let url = event.property_value("URL").unwrap_or("").trim().to_string();

        let (all_day, dtstart) = parse_dt(event, "DTSTART").unwrap_or((false, Utc::now()));
        let dtend = parse_dt(event, "DTEND").map(|(_, dt)| dt);
        let recurrence_id = parse_dt(event, "RECURRENCE-ID").map(|(_, dt)| dt);
        let rrule = event.property_value("RRULE").map(|s| s.to_string());
        let exdates = parse_exdates(event);

        Self {
            uid,
            summary,
            location,
            description,
            url,
            all_day,
            dtstart,
            dtend,
            rrule,
            recurrence_id,
            exdates,
        }
    }
}

fn parse_dt(event: &IcalEvent, name: &str) -> Option<(bool, DateTime<Utc>)> {
    let prop = event.property_value(name)?;
    parse_ical_datetime(prop, !prop.contains('T'))
}

fn parse_ical_datetime(value: &str, force_date: bool) -> Option<(bool, DateTime<Utc>)> {
    let value = value.trim();
    let value = value.rsplit(':').next().unwrap_or(value).trim();
    if force_date || (!value.contains('T') && value.chars().filter(|c| c.is_ascii_digit()).count() >= 8) {
        let digits: String = value.chars().filter(|c| c.is_ascii_digit()).take(8).collect();
        let date = NaiveDate::parse_from_str(&digits, "%Y%m%d").ok()?;
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

fn parse_exdates(event: &IcalEvent) -> Vec<DateTime<Utc>> {
    let mut out = Vec::new();
    if let Some(raw) = event.property_value("EXDATE") {
        for part in raw.split(',') {
            if let Some((_, dt)) = parse_ical_datetime(part.trim(), !part.contains('T')) {
                out.push(dt);
            }
        }
    }
    out
}

pub fn expand_vevents(
    events: &[ParsedVEvent],
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Vec<Occurrence> {
    let mut masters: Vec<&ParsedVEvent> = Vec::new();
    let mut exceptions: Vec<&ParsedVEvent> = Vec::new();
    for ev in events {
        if ev.recurrence_id.is_some() {
            exceptions.push(ev);
        } else {
            masters.push(ev);
        }
    }

    let mut occurrences = Vec::new();

    for master in masters {
        let duration = master
            .dtend
            .map(|e| e - master.dtstart)
            .unwrap_or_else(|| {
                if master.all_day {
                    Duration::days(1)
                } else {
                    Duration::hours(1)
                }
            });

        if let Some(rrule_str) = &master.rrule {
            match expand_rrule(master, rrule_str, window_start, window_end) {
                Ok(starts) => {
                    for start in starts {
                        if master.exdates.iter().any(|d| *d == start) {
                            continue;
                        }
                        // Skip if exception overrides this instance
                        if exceptions.iter().any(|ex| {
                            ex.uid == master.uid
                                && ex.recurrence_id.map(|r| r == start).unwrap_or(false)
                        }) {
                            continue;
                        }
                        occurrences.push(Occurrence {
                            uid: master.uid.clone(),
                            summary: master.summary.clone(),
                            location: master.location.clone(),
                            description: master.description.clone(),
                            url: master.url.clone(),
                            all_day: master.all_day,
                            start,
                            end: start + duration,
                            is_recurring: true,
                            recurrence_id: None,
                            has_rrule: true,
                        });
                    }
                }
                Err(err) => {
                    tracing::warn!("RRULE expand failed for {}: {err}", master.uid);
                    push_single(master, window_start, window_end, &mut occurrences);
                }
            }
        } else {
            push_single(master, window_start, window_end, &mut occurrences);
        }
    }

    for ex in exceptions {
        let start = ex.dtstart;
        let end = ex.dtend.unwrap_or(start);
        if end < window_start || start > window_end {
            continue;
        }
        occurrences.push(Occurrence {
            uid: ex.uid.clone(),
            summary: ex.summary.clone(),
            location: ex.location.clone(),
            description: ex.description.clone(),
            url: ex.url.clone(),
            all_day: ex.all_day,
            start,
            end,
            is_recurring: true,
            recurrence_id: ex.recurrence_id,
            has_rrule: false,
        });
    }

    occurrences.sort_by(|a, b| a.start.cmp(&b.start));
    occurrences
}

fn push_single(
    event: &ParsedVEvent,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
    out: &mut Vec<Occurrence>,
) {
    let end = event.dtend.unwrap_or(event.dtstart);
    if end < window_start || event.dtstart > window_end {
        return;
    }
    out.push(Occurrence {
        uid: event.uid.clone(),
        summary: event.summary.clone(),
        location: event.location.clone(),
        description: event.description.clone(),
        url: event.url.clone(),
        all_day: event.all_day,
        start: event.dtstart,
        end,
        is_recurring: event.recurrence_id.is_some(),
        recurrence_id: event.recurrence_id,
        has_rrule: event.rrule.is_some(),
    });
}

fn expand_rrule(
    master: &ParsedVEvent,
    rrule_str: &str,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> anyhow::Result<Vec<DateTime<Utc>>> {
    let dt_start = master.dtstart.with_timezone(&Tz::UTC);
    let rule: RRule<rrule::Unvalidated> = rrule_str.parse()?;
    let validated = rule.validate(dt_start)?;
    let set = RRuleSet::new(dt_start).rrule(validated);
    let after = window_start.with_timezone(&Tz::UTC) - chrono::Duration::days(1);
    let before = window_end.with_timezone(&Tz::UTC) + chrono::Duration::days(1);
    let dates = set
        .into_iter()
        .skip_while(|d| *d < after)
        .take_while(|d| *d <= before)
        .take(5000)
        .map(|d| d.with_timezone(&Utc))
        .filter(|d| *d >= window_start && *d <= window_end)
        .collect();
    Ok(dates)
}

fn to_utc_iso(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()
}

pub fn normalize_occurrence(
    occurrence: &Occurrence,
    calendar_id: &str,
    calendar_name: &str,
    _index: usize,
    calendar_color: &str,
) -> Option<EventInfo> {
    let start_iso = to_utc_iso(occurrence.start);
    let end_iso = to_utc_iso(occurrence.end);
    let recurrence_id = occurrence
        .recurrence_id
        .map(to_utc_iso)
        .unwrap_or_default();
    let is_recurring = occurrence.has_rrule || occurrence.recurrence_id.is_some();

    Some(EventInfo {
        id: format!("{calendar_id}:{}:{start_iso}", occurrence.uid),
        title: if occurrence.summary.is_empty() {
            "Untitled".into()
        } else {
            occurrence.summary.clone()
        },
        start: start_iso,
        end: end_iso,
        all_day: occurrence.all_day,
        location: occurrence.location.clone(),
        calendar: calendar_name.to_string(),
        calendar_id: calendar_id.to_string(),
        uid: occurrence.uid.clone(),
        description: occurrence.description.clone(),
        url: occurrence.url.clone(),
        is_recurring,
        recurrence_id,
        calendar_color: calendar_color.to_string(),
    })
}
