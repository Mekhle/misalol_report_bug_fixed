use super::helpers::*;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const BODY_MAX: usize = 5000;

async fn config_values(pool: &PgPool, user_id: &Uuid) -> (bool, Option<Value>) {
    let config = read_config(pool, user_id).await;
    let settings = settings_of(config.as_ref());
    let enabled = feature_enabled(&settings, "capsule");
    let cfg = settings.get("capsule").cloned().unwrap_or_else(|| json!({}));
    (enabled, Some(cfg))
}

pub async fn public_view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let (enabled, cfg) = config_values(&pool, &user_id).await;
    if !enabled {
        return Err(err(StatusCode::NOT_FOUND, "feature_off"));
    }
    let cfg = cfg.unwrap_or_else(|| json!({}));
    let label = cfg.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let at = cfg.get("at").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let body_text = cfg.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let state = get_aux(&pool, &user_id, "capsule_open").await;
    let opened_at = state.get("openedAt").and_then(|v| v.as_str());

    let now = chrono::Utc::now();
    let release = chrono::DateTime::parse_from_rfc3339(&at).ok();
    let due = release.map(|r| now >= r.with_timezone(&chrono::Utc)).unwrap_or(false);

    if let Some(opened) = opened_at {
        let _ = opened;
        // already opened → reveal
        ok(json!({
            "state": "open",
            "label": label,
            "opened_at": opened_at,
            "body": body_text,
            "raised": opened_at.is_some(),
        }))
    } else if due {
        // first open after release: record it, reveal body
        set_aux(&pool, &user_id, "capsule_open", &json!({"openedAt": now.to_rfc3339()})).await;
        ok(json!({
            "state": "open",
            "label": label,
            "opened_at": now.to_rfc3339(),
            "body": body_text,
            "raised": false,
        }))
    } else {
        // sealed
        ok(json!({
            "state": "sealed",
            "label": label,
            "at": at,
            "raised": false,
            "body": null,
        }))
    }
}

pub async fn publish(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let cfg = read_config(&pool, &user_id).await;
    let settings = settings_of(cfg.as_ref());
    let capsule = settings.get("capsule").cloned().unwrap_or_else(|| json!({}));
    let body = capsule.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if body.chars().count() > BODY_MAX {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "payload_too_large", "Capsule body too large."));
    }
    set_aux(&pool, &user_id, "capsule_published", &json!(1)).await;
    ok(json!({ "ok": true, "state": "sealed" }))
}

pub async fn unpublish(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    set_aux(&pool, &user_id, "capsule_published", &json!(0)).await;
    ok(json!({ "ok": true, "state": "unpublished" }))
}