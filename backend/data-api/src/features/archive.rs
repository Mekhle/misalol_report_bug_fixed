use super::helpers::*;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const MAX_REVISIONS: i32 = 12;

#[derive(Deserialize)]
pub struct CaptureBody {
    snapshot: Option<Value>,
    reason: Option<String>,
    actor: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct RestoreBody {
    seq: Option<i32>,
    actor: Option<Uuid>,
}

fn head_hash(snapshot: &Value) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(snapshot.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

pub async fn capture(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<CaptureBody>,
) -> ApiResult {
    let snapshot = body.snapshot.unwrap_or_else(|| json!({}));
    let fp = head_hash(&snapshot);
    let latest: Option<(String,)> = sqlx::query_as(
        "SELECT head_hash FROM feature_archive WHERE user_id=$1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    if let Some((h,)) = latest {
        if h == fp {
            return ok(json!({ "ok": true, "created": false, "seq": null }));
        }
    }
    let next_seq: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(seq),0)+1 FROM feature_archive WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(1);
    let reason = body.reason.unwrap_or_else(|| "profile update".to_string());
    sqlx::query(
        "INSERT INTO feature_archive (user_id, seq, snapshot, head_hash, reason, actor)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(user_id)
    .bind(next_seq)
    .bind(&snapshot)
    .bind(&fp)
    .bind(&reason)
    .bind(body.actor)
    .execute(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    // prune oldest beyond MAX_REVISIONS
    let _ = sqlx::query(
        "DELETE FROM feature_archive WHERE user_id=$1 AND seq < (
            SELECT MIN(seq) FROM (
                SELECT seq FROM feature_archive WHERE user_id=$1 ORDER BY seq DESC LIMIT $2
            ) s
        )",
    )
    .bind(user_id)
    .bind(MAX_REVISIONS)
    .execute(&pool)
    .await;
    ok(json!({ "ok": true, "created": true, "seq": next_seq }))
}

pub async fn list(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let rows: Vec<(i32, chrono::DateTime<chrono::Utc>, String, Option<String>)> = sqlx::query_as(
        "SELECT seq, created_at, reason, head_hash FROM feature_archive WHERE user_id=$1 ORDER BY seq DESC",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|(seq, at, reason, hash)| json!({ "seq": seq, "created_at": at.to_rfc3339(), "reason": reason, "head_hash": hash }))
        .collect();
    ok(json!({ "archive": items }))
}

/// Deep redaction so restored old profiles cannot leak capsule or secret material.
fn redact_into(snapshot: &mut Value, path: &mut String) {
    match snapshot {
        Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                let prev_len = path.len();
                if !path.is_empty() {
                    path.push('.');
                }
                path.push_str(&key);
                if let Some(v) = map.get_mut(&key) {
                    redact_into(v, path);
                }
                path.truncate(prev_len);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                redact_into(v, path);
            }
        }
        Value::String(s) => {
            if path == "settings.capsule.text" {
                *s = String::new();
            }
        }
        _ => {}
    }
}

fn redact(snapshot: Value) -> Value {
    let mut snap = snapshot;
    redact_into(&mut snap, &mut String::new());
    // secret material lives as a string only in the old plaintext model; drop any extra copies
    if let Some(settings) = snap.get_mut("settings") {
        for key in ["secret"] {
            if let Some(secret) = settings.get_mut(key) {
                if let Some(obj) = secret.as_object_mut() {
                    for k in ["word", "url"] {
                        if let Some(val) = obj.get_mut(k) {
                            *val = json!("");
                        }
                    }
                }
            }
        }
    }
    snap
}

pub async fn get(
    State(pool): State<PgPool>,
    Path((user_id, seq)): Path<(Uuid, i32)>,
) -> ApiResult {
    let row: Option<(sqlx::types::Json<Value>,)> = sqlx::query_as(
        "SELECT snapshot FROM feature_archive WHERE user_id=$1 AND seq=$2",
    )
    .bind(user_id)
    .bind(seq)
    .fetch_optional(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    match row {
        Some((snap,)) => ok(json!({ "seq": seq, "snapshot": snap.0 })),
        None => Err(err(StatusCode::NOT_FOUND, "revision_not_found")),
    }
}

pub async fn restore(
    State(pool): State<PgPool>,
    Path((user_id, _seq)): Path<(Uuid, i32)>,
    Json(body): Json<RestoreBody>,
) -> ApiResult {
    let seq = match body.seq {
        Some(s) => s,
        None => return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "seq_required", "Revision required.")),
    };
    let row: Option<(sqlx::types::Json<Value>,)> = sqlx::query_as(
        "SELECT snapshot FROM feature_archive WHERE user_id=$1 AND seq=$2",
    )
    .bind(user_id)
    .bind(seq)
    .fetch_optional(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    let (snap,) = match row {
        Some(x) => x,
        None => return Err(err(StatusCode::NOT_FOUND, "revision_not_found")),
    };

    // non-destructive: snapshot the pre-restore state first
    if let Some(current) = read_config(&pool, &user_id).await {
        let _ = capture(
            State(pool.clone()),
            Path(user_id),
            Json(CaptureBody {
                snapshot: Some(current),
                reason: Some("pre-restore".to_string()),
                actor: body.actor,
            }),
        )
        .await;
    }

    let restored = redact(snap.0);
    crate::db::save_profile(&pool, user_id, restored.clone())
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    ok(json!({ "ok": true, "seq": seq, "restored": true }))
}