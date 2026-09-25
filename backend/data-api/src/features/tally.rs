use super::helpers::*;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const Q_MIN: usize = 1;
pub const Q_MAX: usize = 140;
pub const OPTIONS_MIN: usize = 2;
pub const OPTIONS_MAX: usize = 12;
pub const OPTION_MAX: usize = 64;

#[derive(Deserialize)]
pub struct PublishBody {
    poll: Option<Value>,
}

#[derive(Deserialize)]
pub struct VoteBody {
    token: Option<String>,
    option: Option<String>,
    idem: Option<String>,
}

fn fingerprint(poll: &Value) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(poll.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

async fn latest(pool: &PgPool, user_id: &Uuid) -> Option<(Uuid, i32, Value, String)> {
    sqlx::query_as::<_, (Uuid, i32, sqlx::types::Json<Value>, String)>(
        "SELECT id, revision, poll, status FROM feature_tally_polls
         WHERE user_id=$1 ORDER BY published_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|(id, rev, poll, status)| (id, rev, poll.0, status))
}

fn validate_poll(poll: &Value) -> Result<(), (StatusCode, Json<Value>)> {
    let q = match poll.get("q") {
        Some(Value::String(s)) => s,
        _ => return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_poll", "Poll needs a question.")),
    };
    let qn = q.chars().count();
    if !(Q_MIN..=Q_MAX).contains(&qn) {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "bad_question", "Question length out of range."));
    }
    let options = match poll.get("options") {
        Some(Value::Array(a)) => a,
        _ => return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_poll", "Poll needs options.")),
    };
    let on = options.len();
    if !(OPTIONS_MIN..=OPTIONS_MAX).contains(&on) {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "bad_options", "Option count out of range."));
    }
    let mut seen = std::collections::HashSet::new();
    for opt in options {
        match opt.as_str() {
            Some(s) => {
                let len = s.chars().count();
                if len == 0 || len > OPTION_MAX {
                    return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "bad_option", "Option too long."));
                }
                if !seen.insert(s.to_string()) {
                    return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "duplicate_option", "Duplicate option."));
                }
            }
            None => return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_option", "Option must be a string.")),
        }
    }
    Ok(())
}

pub async fn current(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    match latest(&pool, &user_id).await {
        Some((id, revision, poll, status)) => {
            let closed = status == "closed";
            let visibility = poll
                .get("visibility")
                .and_then(|v| v.as_str())
                .unwrap_or("afterVote");
            let show_totals = closed || visibility == "always";
            let counts: Vec<(String, i64)> = sqlx::query_as(
                "SELECT option_id, COUNT(*) FROM feature_tally_votes WHERE poll_id=$1 GROUP BY option_id",
            )
            .bind(id)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();
            let totals: Value = if show_totals {
                let mut map = serde_json::Map::new();
                for (option_id, count) in counts {
                    map.insert(option_id, json!(count));
                }
                Value::Object(map)
            } else {
                Value::Null
            };
            ok(json!({
                "poll": {
                    "id": id,
                    "revision": revision,
                    "q": poll.get("q"),
                    "options": poll.get("options"),
                    "visibility": visibility,
                    "status": status,
                },
                "counts": totals,
                "closed": closed,
            }))
        }
        None => ok(json!({ "poll": null })),
    }
}

pub async fn publish(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<PublishBody>,
) -> ApiResult {
    let poll = body.poll.unwrap_or(Value::Null);
    validate_poll(&poll)?;
    let fp = fingerprint(&poll);
    if let Some((_id, revision, current_poll, status)) = latest(&pool, &user_id).await {
        if status == "open" && fingerprint(&current_poll) == fp {
            return ok(json!({ "ok": true, "unchanged": true, "revision": revision }));
        }
    }
    let revision: i32 = latest(&pool, &user_id).await.map(|x| x.1 + 1).unwrap_or(1);
    let id = new_uuid();
    sqlx::query(
        "INSERT INTO feature_tally_polls (id, user_id, revision, poll, status, published_at) VALUES ($1,$2,$3,$4,'open',NOW())",
    )
    .bind(id)
    .bind(user_id)
    .bind(revision)
    .bind(&poll)
    .execute(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    ok(json!({ "ok": true, "poll_id": id, "revision": revision }))
}

fn hmac_key(poll_id: &Uuid, input: &str) -> String {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(poll_id.to_string().as_bytes()).expect("hmac ok");
    mac.update(input.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

pub async fn vote(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<VoteBody>,
) -> ApiResult {
    let (poll_id, _rev, poll, status) = match latest(&pool, &user_id).await {
        Some(x) => x,
        None => return Err(err_reason(StatusCode::NOT_FOUND, "no_poll", "There is no poll.")),
    };
    if status != "open" {
        return Err(err_reason(StatusCode::FORBIDDEN, "poll_closed", "This poll is closed."));
    }
    let token = body.token.unwrap_or_default();
    if token.is_empty() {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "token_required", "Token required."));
    }
    let idem = body.idem.unwrap_or_default();
    if idem.is_empty() {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "idem_required", "Idempotency key required."));
    }
    let option = body.option.unwrap_or_default();
    let options = poll.get("options").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let option_idx = options.iter().position(|o| o.as_str() == Some(&option));
    if option_idx.is_none() {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "bad_option", "Unknown option."));
    }

    let key = hmac_key(&poll_id, &token);
    let idem_key = hmac_key(&poll_id, &format!("idem:{token}"));

    // idempotent replay of the same choice
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT option_id FROM feature_tally_votes WHERE poll_id=$1 AND key=$2",
    )
    .bind(poll_id)
    .bind(&key)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    if let Some(existing_option) = existing {
        if existing_option == option {
            return ok(json!({ "ok": true, "already": true, "poll_id": poll_id }));
        }
        return Err(err_reason(StatusCode::CONFLICT, "already_voted", "Already voted."));
    }

    let res = sqlx::query(
        "INSERT INTO feature_tally_votes (id, poll_id, key, option_id, idem) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(new_uuid())
    .bind(poll_id)
    .bind(&key)
    .bind(option.as_str())
    .bind(idem_key)
    .execute(&pool)
    .await;
    match res {
        Ok(_) => ok(json!({ "ok": true, "poll_id": poll_id, "counted": true })),
        Err(e) if e.as_database_error().map(|d| d.code().as_deref() == Some("23505")).unwrap_or(false) => {
            Err(err_reason(StatusCode::CONFLICT, "already_voted", "Already voted."))
        }
        Err(_) => Err(err(StatusCode::INTERNAL_SERVER_ERROR, "store_error")),
    }
}

pub async fn close(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let affected = sqlx::query("UPDATE feature_tally_polls SET status='closed', closed_at=NOW() WHERE user_id=$1 AND status='open'")
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    if affected.rows_affected() == 0 {
        return Err(err_reason(StatusCode::CONFLICT, "not_open", "No open poll."));
    }
    ok(json!({ "ok": true, "status": "closed" }))
}

pub async fn reopen(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let affected = sqlx::query("UPDATE feature_tally_polls SET status='open', closed_at=NULL WHERE user_id=$1 AND status='closed'")
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    if affected.rows_affected() == 0 {
        return Err(err_reason(StatusCode::CONFLICT, "not_closed", "No closed poll."));
    }
    ok(json!({ "ok": true, "status": "open" }))
}

pub async fn reset(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    // A reset starts a fresh revision so old votes stay readable in revision history.
    let (poll_id, _rev, poll, _status) = match latest(&pool, &user_id).await {
        Some(x) => x,
        None => return Err(err_reason(StatusCode::NOT_FOUND, "no_poll", "There is no poll.")),
    };
    let _ = sqlx::query("UPDATE feature_tally_polls SET status='closed', closed_at=NOW() WHERE id=$1")
        .bind(poll_id)
        .execute(&pool)
        .await;
    publish(State(pool), Path(user_id), Json(PublishBody { poll: Some(poll) })).await
}