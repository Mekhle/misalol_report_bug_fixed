use super::helpers::*;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::Timelike;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

fn parse_hhmm(value: Option<&serde_json::Value>, def: u32) -> u32 {
    let raw = match value {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => return (def % 24) * 60,
    };
    if let Ok(n) = raw.parse::<i64>() {
        return (n.clamp(0, 1439) as u32) % 1440;
    }
    let parts: Vec<&str> = raw.split(':').collect();
    if parts.len() != 2 {
        return (def % 24) * 60;
    }
    let h: u32 = parts[0].parse().unwrap_or(def % 24) % 24;
    let m: u32 = parts[1].parse().unwrap_or(0) % 60;
    h * 60 + m
}

fn in_window(minutes: u32, start: u32, end: u32) -> bool {
    if start == end {
        return minutes == start;
    }
    if start < end {
        minutes >= start && minutes < end
    } else {
        minutes >= start || minutes < end
    }
}

pub async fn view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let config = read_config(&pool, &user_id).await;
    let settings = settings_of(config.as_ref());
    if !feature_enabled(&settings, "night") {
        return Err(err(StatusCode::NOT_FOUND, "feature_off"));
    }
    let night_cfg = settings.get("night").cloned().unwrap_or_else(|| json!({}));
    let tz_name = night_cfg
        .get("tz")
        .and_then(|v| v.as_str())
        .unwrap_or("UTC")
        .to_string();
    let start = parse_hhmm(night_cfg.get("from"), 23);
    let end = parse_hhmm(night_cfg.get("to"), 5);

    let now_utc = chrono::Utc::now();
    let tz: chrono_tz::Tz = tz_name.parse().unwrap_or(chrono_tz::UTC);
    let local = now_utc.with_timezone(&tz);
    let minutes = (local.hour() * 60 + local.minute()) as u32;
    let visible = in_window(minutes, start, end);

    ok(json!({
        "active": visible,
        "visible": visible,
        "timezone": tz_name,
        "from": format!("{:02}:{:02}", start / 60, start % 60),
        "to": format!("{:02}:{:02}", end / 60, end % 60),
        "local": local.to_rfc3339(),
    }))
}