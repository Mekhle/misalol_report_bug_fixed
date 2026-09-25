use super::helpers::*;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct HitBody {
    token: Option<String>,
    skip: Option<bool>,
    ua: Option<String>,
}

fn dedup_key(user_id: &Uuid, token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(user_id.as_bytes());
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn is_bot(ua: &str) -> bool {
    const PATTERNS: [&str; 8] = [
        "bot", "crawler", "spider", "slurp", "bingpreview", "facebookexternalhit", "headless", "prerender",
    ];
    let lower = ua.to_ascii_lowercase();
    PATTERNS.iter().any(|p| lower.contains(p))
}

pub async fn record(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<HitBody>,
) -> ApiResult {
    if body.skip.unwrap_or(false) {
        return ok(json!({ "ok": true, "counted": false, "reason": "skipped" }));
    }
    let ua = body.ua.unwrap_or_default();
    if is_bot(&ua) {
        return ok(json!({ "ok": true, "counted": false, "reason": "bot" }));
    }
    let token = body.token.unwrap_or_default().trim().to_string();
    if token.is_empty() {
        return Err(err_reason(
            StatusCode::UNPROCESSABLE_ENTITY,
            "token_required",
            "A visitor token is required.",
        ));
    }
    let key = dedup_key(&user_id, &token);
    // de-dupe within the visitor's session; only unique visitors count
    let inserted = sqlx::query(
        "INSERT INTO feature_hit_dedup (key, user_id, at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO NOTHING",
    )
    .bind(&key)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    if inserted.rows_affected() == 0 {
        return ok(json!({ "ok": true, "counted": false, "reason": "dup" }));
    }
    sqlx::query(
        "INSERT INTO feature_hits (user_id, count, updated_at) VALUES ($1, 1, NOW())
         ON CONFLICT (user_id) DO UPDATE SET count = feature_hits.count + 1, updated_at = NOW()",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    let count: i64 = sqlx::query_scalar("SELECT count FROM feature_hits WHERE user_id=$1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(1);
    ok(json!({ "ok": true, "counted": true, "count": count }))
}

pub async fn view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let count: i64 = sqlx::query_scalar("SELECT count FROM feature_hits WHERE user_id=$1")
        .bind(user_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);
    ok(json!({ "count": count }))
}