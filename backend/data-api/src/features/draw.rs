use super::helpers::*;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const CARDS_MAX: usize = 12;
pub const CARD_MAX: usize = 160;

fn today_key() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn cards_from_cfg(cfg: &Value) -> Vec<String> {
    let mut cards: Vec<String> = match cfg {
        Value::String(s) => s.lines().map(|l| l.trim().to_string()).collect(),
        Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .collect(),
        _ => Vec::new(),
    };
    cards.retain(|c| !c.is_empty() && c.chars().count() <= CARD_MAX);
    cards.truncate(CARDS_MAX);
    cards
}

pub async fn view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let config = read_config(&pool, &user_id).await;
    let settings = settings_of(config.as_ref());
    if !feature_enabled(&settings, "draw") {
        return Err(err(StatusCode::NOT_FOUND, "feature_off"));
    }
    let raw = settings.get("draw").cloned().unwrap_or_else(|| json!(""));
    let cards = cards_from_cfg(&raw);
    if cards.is_empty() {
        return Err(err_reason(StatusCode::NOT_FOUND, "no_deck", "No deck configured."));
    }

    let today = today_key();
    let state = get_aux(&pool, &user_id, "draw").await;
    let aux_day = state.get("day").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let aux_cards = state.get("cards").cloned().unwrap_or_else(|| json!([]));
    let config_fp = format!("{:?}", cards);

    if aux_day != today {
        // lazy promotion once per owner-local day
        set_aux(
            &pool,
            &user_id,
            "draw",
            &json!({ "day": today, "cards": cards.as_slice().iter().map(|c| json!(c)).collect::<Vec<_>>(), "fp": config_fp }),
        )
        .await;
    } else if value_fp(&aux_cards) != config_fp {
        set_aux(&pool, &user_id, "draw", &json!({ "day": today, "fp": config_fp })).await;
    }

    ok(json!({ "day": today, "cards": cards.iter().map(|c| json!(c)).collect::<Vec<_>>() }))
}

fn value_fp(v: &Value) -> String {
    format!("{:?}", v)
}