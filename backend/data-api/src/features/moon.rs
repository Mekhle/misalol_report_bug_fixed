use super::helpers::*;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

/// Approximate lunar age fraction at a UTC instant (Meeus-truncated).
/// Reference: known new moon 2000-01-06 18:14:00 UTC (946_768_440 epoch seconds).
/// Synodic month 29.530588853 days.
fn age_fraction(utc_secs: i64) -> f64 {
    const REF_SEQ: i64 = 946_768_440;
    const SYNODIC_S: f64 = 29.530588853 * 86400.0;
    let elapsed = utc_secs.saturating_sub(REF_SEQ) as f64;
    let f = (elapsed % SYNODIC_S) / SYNODIC_S;
    if f < 0.0 { f + 1.0 } else { f }
}

fn phase_name(age: f64) -> &'static str {
    // age fraction 0..1 → New ... Waxing crescent ... First quarter ... Waxing gibbous ... Full ... Waning gibbous ... Last quarter ... Waning crescent
    let e = age * 8.0;
    match e {
        x if x < 1.0 => "New moon",
        x if x < 2.0 => "Waxing crescent",
        x if x < 3.0 => "First quarter",
        x if x < 4.0 => "Waxing gibbous",
        x if x < 5.0 => "Full moon",
        x if x < 6.0 => "Waning gibbous",
        x if x < 7.0 => "Last quarter",
        _ => "Waning crescent",
    }
}

pub async fn view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let config = read_config(&pool, &user_id).await;
    let settings = settings_of(config.as_ref());
    if !feature_enabled(&settings, "moon") {
        return Err(err(StatusCode::NOT_FOUND, "feature_off"));
    }
    let hemisphere = settings
        .get("moon")
        .and_then(|m| m.get("hemisphere"))
        .and_then(|v| v.as_str())
        .unwrap_or("north")
        .to_string();
    let utc_secs = chrono::Utc::now().timestamp();
    let age = age_fraction(utc_secs);
    let phase = phase_name(age);
    let illumination = (1.0 - (2.0 * std::f64::consts::PI * age).cos()) / 2.0;
    let percent = (illumination * 100.0).round() as i64;
    let waxing = age < 0.5;
    let waning = age >= 0.5;
    let north = hemisphere.eq_ignore_ascii_case("north");
    // lit side: waxing north or waning south → right, else left
    let side = if (waxing && north) || (waning && !north) { "right" } else { "left" };
    let label = format!("{}, {}% lit", phase, percent);
    ok(json!({
        "phase": phase,
        "illumination": (illumination * 1000.0).round() / 1000.0,
        "percent": percent,
        "waxing": waxing,
        "waning": waning,
        "direction": if waxing { "waxing" } else { "waning" },
        "hemisphere": hemisphere,
        "side": side,
        "label": label,
    }))
}