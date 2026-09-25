use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;

pub type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

pub fn ok(value: Value) -> ApiResult {
    Ok(Json(value))
}

pub fn err(status: StatusCode, code: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": code })))
}

pub fn err_reason(status: StatusCode, code: &str, reason: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": code, "reason": reason })))
}

pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

#[allow(dead_code)]
pub fn now_iso() -> String {
    now_utc().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub async fn read_config(pool: &PgPool, user_id: &uuid::Uuid) -> Option<Value> {
    let row: Option<(sqlx::types::Json<Value>,)> = sqlx::query_as(
        "SELECT config FROM profiles WHERE user_id = $1 AND disabled_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.map(|r| r.0 .0)
}

pub fn settings_of(config: Option<&Value>) -> Value {
    config
        .and_then(|c| c.get("settings"))
        .cloned()
        .unwrap_or_else(|| json!({}))
}

/// Feature switch check: `settings.<key>` present and truthy-ish.
/// Accepts bool true or a non-empty object/array (e.g. `tally: {q,options}`).
pub fn feature_enabled(settings: &Value, key: &str) -> bool {
    match settings.get(key) {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Null) => false,
        Some(Value::Object(map)) => !map.is_empty(),
        Some(Value::Array(arr)) => !arr.is_empty(),
        Some(Value::Number(_)) | Some(Value::String(_)) => true,
    }
}

pub async fn get_aux(pool: &PgPool, user_id: &uuid::Uuid, feature: &str) -> Value {
    let row: Option<(sqlx::types::Json<Value>,)> = sqlx::query_as(
        "SELECT state FROM feature_aux WHERE user_id = $1 AND feature = $2",
    )
    .bind(user_id)
    .bind(feature)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some(r) => r.0 .0,
        None => json!({}),
    }
}

pub async fn set_aux(pool: &PgPool, user_id: &uuid::Uuid, feature: &str, state: &Value) {
    let _ = sqlx::query(
        "INSERT INTO feature_aux (user_id, feature, state, updated_at) VALUES ($1,$2,$3,NOW())
         ON CONFLICT (user_id, feature) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()",
    )
    .bind(user_id)
    .bind(feature)
    .bind(state)
    .execute(pool)
    .await;
}

pub fn new_uuid() -> uuid::Uuid {
    uuid::Uuid::new_v4()
}

/// Short stable fingerprint of a source IP, hex-encoded (raw IP is never stored).
pub fn scope_key(ip: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(ip.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    hex.chars().take(16).collect()
}

pub fn new_public_id() -> String {
    let bytes = uuid::Uuid::new_v4();
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes.as_bytes())
}

/// Sliding-window rate limiter backed by `feature_rates`.
/// Returns Ok(()) when a call is allowed, Err((429, json)) with retry info otherwise.
pub async fn rate_limit(
    pool: &PgPool,
    user_id: &uuid::Uuid,
    scope: &str,
    key: &str,
    window_ms: i64,
    max: i64,
) -> Result<(), (StatusCode, Json<Value>)> {
    let window = Duration::milliseconds(window_ms);
    let window_start = now_utc() - window;
    let row: Option<(i32,)> = sqlx::query_as(
        "SELECT count FROM feature_rates WHERE user_id=$1 AND scope=$2 AND key=$3 AND win_start >= $4",
    )
    .bind(user_id)
    .bind(scope)
    .bind(key)
    .bind(window_start)
    .fetch_optional(pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "rate_store_error"))?;

    match row {
        Some((count,)) if (count as i64) >= max => Err(err_reason(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many attempts. Try again later.",
        )),
        Some((_count,)) => {
            let _ = sqlx::query(
                "UPDATE feature_rates SET count = count + 1 WHERE user_id=$1 AND scope=$2 AND key=$3 AND win_start >= $4",
            )
            .bind(user_id)
            .bind(scope)
            .bind(key)
            .bind(window_start)
            .execute(pool)
            .await;
            Ok(())
        }
        None => {
            let _ = sqlx::query(
                "INSERT INTO feature_rates (user_id, scope, key, win_start, count) VALUES ($1,$2,$3,NOW(),1)
                 ON CONFLICT (user_id, scope, key) DO UPDATE SET count = feature_rates.count + 1
                 WHERE feature_rates.win_start >= $4",
            )
            .bind(user_id)
            .bind(scope)
            .bind(key)
            .bind(window_start)
            .execute(pool)
            .await;
            Ok(())
        }
    }
}