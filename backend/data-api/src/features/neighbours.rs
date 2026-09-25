use super::helpers::*;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const SLOTS_MAX: i64 = 5;
pub const NAME_MAX: usize = 40;

#[derive(Deserialize)]
pub struct Nominate {
    to_username: Option<String>,
}

async fn enabled(pool: &PgPool, user_id: &Uuid) -> bool {
    let settings = settings_of(read_config(pool, user_id).await.as_ref());
    feature_enabled(&settings, "neighbours")
      && settings
          .get("neighbours")
          .and_then(|v| v.as_bool())
          .unwrap_or(true)
}

async fn user_id_of(pool: &PgPool, username: &str) -> Option<Uuid> {
    sqlx::query_scalar("SELECT id FROM users WHERE LOWER(username) = LOWER($1)")
        .bind(username)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

pub async fn nominate(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<Nominate>,
) -> ApiResult {
    if !enabled(&pool, &user_id).await {
        return Err(err(StatusCode::NOT_FOUND, "feature_off"));
    }
    let to = body.to_username.unwrap_or_default().trim().to_string();
    if to.is_empty() || to.chars().count() > NAME_MAX {
        return Err(err_reason(StatusCode::UNPROCESSABLE_ENTITY, "invalid_name", "Invalid neighbour username."));
    }
    let to_id = match user_id_of(&pool, &to).await {
        Some(id) => id,
        None => return Err(err_reason(StatusCode::NOT_FOUND, "user_not_found", "That profile does not exist.")),
    };
    if to_id == user_id {
        return Err(err_reason(StatusCode::CONFLICT, "self_nomination", "You cannot nominate yourself."));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM feature_neighbours WHERE from_user_id=$1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    if count >= SLOTS_MAX {
        return Err(err_reason(StatusCode::CONFLICT, "slots_full", "Neighbour slots are full."));
    }
    let dup: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM feature_neighbours WHERE from_user_id=$1 AND to_username=$2")
            .bind(user_id)
            .bind(&to)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    if dup.is_some() {
        return Err(err_reason(StatusCode::CONFLICT, "duplicate", "Already nominated."));
    }
    let ord: i64 = count;
    sqlx::query(
        "INSERT INTO feature_neighbours (id, from_user_id, to_username, to_user_id, ord)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(new_uuid())
    .bind(user_id)
    .bind(&to)
    .bind(to_id)
    .bind(ord)
    .execute(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    ok(json!({ "ok": true, "username": to }))
}

pub async fn remove(
    State(pool): State<PgPool>,
    Path((user_id, to_username)): Path<(Uuid, String)>,
) -> ApiResult {
    let affected = sqlx::query("DELETE FROM feature_neighbours WHERE from_user_id=$1 AND to_username=$2")
        .bind(user_id)
        .bind(&to_username)
        .execute(&pool)
        .await
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    if affected.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "neighbour_not_found"));
    }
    ok(json!({ "ok": true, "username": to_username }))
}

pub async fn owner_view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    let rows: Vec<(String, i32)> = sqlx::query_as(
        "SELECT to_username, ord FROM feature_neighbours WHERE from_user_id=$1 ORDER BY ord ASC",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    let mut nominees: Vec<Value> = Vec::new();
    let mut slots = rows.len() as i64;
    for (u, _) in rows {
        slots -= 1;
        let mutual = is_mutual(&pool, &user_id, &u).await.unwrap_or(false);
        nominees.push(json!({ "username": u, "mutual": mutual }));
    }
    ok(json!({ "slots": slots, "neighbours": nominees }))
}

async fn is_mutual(pool: &PgPool, user_id: &Uuid, to: &str) -> Option<bool> {
    // reciprocal edge: the target user must be a real user that nominated user_id back
    let to_id = user_id_of(pool, to).await?;
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM feature_neighbours WHERE from_user_id=$1 AND to_user_id=$2)",
    )
    .bind(to_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .ok()
}

pub async fn public_view(
    State(pool): State<PgPool>,
    Path(user_id): Path<Uuid>,
) -> ApiResult {
    if !enabled(&pool, &user_id).await {
        return Err(err(StatusCode::NOT_FOUND, "feature_off"));
    }
    let rows: Vec<(String, i32)> = sqlx::query_as(
        "SELECT to_username, ord FROM feature_neighbours WHERE from_user_id=$1 ORDER BY ord ASC",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "store_error"))?;
    let mut neighbours: Vec<Value> = Vec::new();
    for (u, _) in rows {
        if is_mutual(&pool, &user_id, &u).await.unwrap_or(false) {
            neighbours.push(json!({ "username": u, "mutual": true }));
        }
    }
    ok(json!({ "neighbours": neighbours }))
}