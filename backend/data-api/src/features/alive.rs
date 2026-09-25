use super::helpers::*;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

const LEASE_MIN_S: i64 = 10;
const LEASE_MAX_S: i64 = 300;
const LEASE_DEFAULT_S: i64 = 60;

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct HeartbeatBody {
    token: Option<String>,
    lease_seconds: Option<i64>,
}

async fn active_count(pool: &PgPool, user_id: &Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM feature_leases WHERE user_id=$1 AND expires_at > NOW()",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0)
}

pub async fn heartbeat(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<HeartbeatBody>,
) -> ApiResult {
    let token = body.token.unwrap_or_default().trim().to_string();
    if token.is_empty() || token.len() > 128 {
        return Err(err_reason(
            StatusCode::UNPROCESSABLE_ENTITY,
            "token_required",
            "A valid presence token is required.",
        ));
    }
    let lease = body
        .lease_seconds
        .map(|s| s.clamp(LEASE_MIN_S, LEASE_MAX_S))
        .unwrap_or(LEASE_DEFAULT_S);
    let now = chrono::Utc::now();
    let expires = now + chrono::Duration::seconds(lease);

    let existing: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM feature_leases WHERE user_id=$1 AND token=$2")
            .bind(user_id)
            .bind(&token)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    match existing {
        Some(id) => {
            // only renew leases that are still alive; a stale token starts fresh
            let alive: bool = sqlx::query_scalar(
                "SELECT expires_at > NOW() FROM feature_leases WHERE id=$1",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap_or(false);
            if alive {
                sqlx::query("UPDATE feature_leases SET last_seen=NOW(), expires_at=$3 WHERE id=$1")
                    .bind(id)
                    .bind(user_id)
                    .bind(expires)
                    .execute(&pool)
                    .await
                    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
            } else {
                sqlx::query("UPDATE feature_leases SET first_seen=NOW(), last_seen=NOW(), expires_at=$3 WHERE id=$1")
                    .bind(id)
                    .bind(user_id)
                    .bind(expires)
                    .execute(&pool)
                    .await
                    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
            }
            // prune expired leases for the owner profile
            let _ = sqlx::query("DELETE FROM feature_leases WHERE user_id=$1 AND expires_at <= NOW()")
                .bind(user_id)
                .execute(&pool)
                .await;
            let count = active_count(&pool, &user_id).await;
            ok(json!({ "ok": true, "renewed": true, "active": count, "expires_at": expires.to_rfc3339() }))
        }
        None => {
            sqlx::query(
                "INSERT INTO feature_leases (id, user_id, token, first_seen, last_seen, expires_at)
                 VALUES ($1,$2,$3,NOW(),NOW(),$4)",
            )
            .bind(new_uuid())
            .bind(user_id)
            .bind(&token)
            .bind(expires)
            .execute(&pool)
            .await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
            let count = active_count(&pool, &user_id).await;
            ok(json!({ "ok": true, "renewed": false, "active": count, "expires_at": expires.to_rfc3339() }))
        }
    }
}

pub async fn count(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let count = active_count(&pool, &user_id).await;
    let now = chrono::Utc::now().to_rfc3339();
    ok(json!({ "active": count, "now": now, "unit": "ms" }))
}

pub async fn snuff(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let result = sqlx::query("DELETE FROM feature_leases WHERE user_id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    ok(json!({ "ok": true, "cleared": result.rows_affected() }))
}