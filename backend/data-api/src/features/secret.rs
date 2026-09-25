use super::helpers::*;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const WORD_MAX: usize = 256;
pub const URL_MAX: usize = 200;
pub const LABEL_MAX: usize = 64;
pub const RATE_MAX: i64 = 10;
pub const RATE_WINDOW_MS: i64 = 600_000;
pub const GRANT_TTL_MIN: i64 = 5;
pub const SCRYPT_LOG_N: u8 = 14;
pub const SCRYPT_R: u32 = 8;
pub const SCRYPT_P: u32 = 1;
pub const SCRYPT_LEN: usize = 32;

#[derive(Deserialize)]
pub struct SetBody {
    word: Option<String>,
    url: Option<String>,
    label: Option<String>,
}

#[derive(Deserialize)]
pub struct TryBody {
    word: Option<String>,
    ip: Option<String>,
}

fn do_verifier(word: &str, salt: &[u8]) -> Vec<u8> {
    let params = scrypt::Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN).expect("scrypt params");
    let mut out = vec![0u8; SCRYPT_LEN];
    scrypt::scrypt(word.as_bytes(), salt, &params, &mut out).expect("scrypt");
    out
}

async fn vget(pool: &PgPool, user_id: &Uuid) -> Value {
    get_aux(pool, user_id, "secret").await
}

pub async fn set(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<SetBody>,
) -> ApiResult {
    let word = body.word.unwrap_or_default().trim().to_string();
    if word.is_empty() || word.chars().count() > WORD_MAX {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_word", "Word length out of range."));
    }
    let url = body.url.unwrap_or_default().trim().to_string();
    if url.is_empty() || url.chars().count() > URL_MAX {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_url", "URL length out of range."));
    }
    let label = body.label.unwrap_or_default().trim().to_string();
    if label.chars().count() > LABEL_MAX {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_label", "Label length out of range."));
    }

    let state = vget(&pool, &user_id).await;
    let version = state.get("version").and_then(|v| v.as_i64()).unwrap_or(0) + 1;
    let salt: [u8; 16] = rand::random();
    let hash = do_verifier(&word, &salt);
    let hash_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&hash);
    let salt_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&salt);

    set_aux(
        &pool,
        &user_id,
        "secret",
        &json!({ "version": version, "hash": hash_b64, "salt": salt_b64, "url": url, "label": label }),
    )
    .await;
    // rotation invalidates every outstanding grant
    let _ = sqlx::query("DELETE FROM feature_secret_grants WHERE user_id=$1")
        .bind(user_id)
        .execute(&pool)
        .await;
    ok(json!({ "ok": true, "version": version }))
}

pub async fn clear(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let _ = sqlx::query("DELETE FROM feature_secret_grants WHERE user_id=$1")
        .bind(user_id)
        .execute(&pool)
        .await;
    set_aux(&pool, &user_id, "secret", &json!({ "version": 0 })).await;
    ok(json!({ "ok": true }))
}

fn verify(word: &str, salt_b64: &str, hash_b64: &str) -> bool {
    let salt = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(salt_b64)
        .unwrap_or_default();
    let expected = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(hash_b64)
        .unwrap_or_default();
    let actual = do_verifier(word, &salt);
    actual.len() == expected.len() && {
        let mut diff = 0u8;
        for (a, b) in actual.iter().zip(expected.iter()) {
            diff |= a ^ b;
        }
        diff == 0
    }
}

pub async fn attempt(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<TryBody>,
) -> ApiResult {
    let state = vget(&pool, &user_id).await;
    let hash = state.get("hash").and_then(|v| v.as_str()).unwrap_or("");
    if hash.is_empty() {
        return Err(err_reason(StatusCode::NOT_FOUND, "not_set", "No secret configured."));
    }
    let ip = body.ip.clone().unwrap_or_else(|| "?".to_string());
    rate_limit(&pool, &user_id, "secret_attempt", &scope_key(&ip), RATE_WINDOW_MS, RATE_MAX).await?;
    let word = body.word.unwrap_or_default();
    if !verify(&word, state.get("salt").and_then(|v| v.as_str()).unwrap_or(""), hash) {
        return Err(err_reason(StatusCode::FORBIDDEN, "wrong_word", "Not unlocked."));
    }
    let version = state.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
    let grant = new_uuid();
    let expires = chrono::Utc::now() + chrono::Duration::minutes(GRANT_TTL_MIN);
    sqlx::query(
        "INSERT INTO feature_secret_grants (id, user_id, version, expires_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(grant)
    .bind(user_id)
    .bind(version)
    .bind(expires)
    .execute(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    let url = state.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let label = state.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
    ok(json!({ "grant": grant, "url": url, "label": label, "expires_at": expires.to_rfc3339() }))
}

pub async fn resolve(
    State(pool): State<PgPool>,
    Path((user_id, grant)): Path<(Uuid, Uuid)>,
) -> ApiResult {
    let state = vget(&pool, &user_id).await;
    let version = state.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
    let row: Option<(i32,)> = sqlx::query_as(
        "SELECT version FROM feature_secret_grants WHERE id=$1 AND user_id=$2 AND expires_at > NOW()",
    )
    .bind(grant)
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    match row {
        Some((grant_version,)) if grant_version == version as i32 => {
            let url = state.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let label = state.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
            // single-use: consume the grant
            let _ = sqlx::query("DELETE FROM feature_secret_grants WHERE id=$1")
                .bind(grant)
                .execute(&pool)
                .await;
            ok(json!({ "ok": true, "url": url, "label": label }))
        }
        Some(_) => Err(err_reason(
            StatusCode::GONE,
            "grant_stale",
            "Grant expired or invalidated.",
        )),
        None => Err(err_reason(StatusCode::GONE, "grant_stale", "Grant expired or invalidated.")),
    }
}