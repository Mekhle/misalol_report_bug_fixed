use crate::db::{self, NewUser, OAuthRequest, ProfileWrite, User, UserPatch};
use axum::extract::{FromRef, Path, Query, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub api_key: String,
}

impl FromRef<AppState> for PgPool {
    fn from_ref(state: &AppState) -> PgPool {
        state.pool.clone()
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    if a_bytes.len() != b_bytes.len() {
        return false;
    }
    let mut res = 0u8;
    for (x, y) in a_bytes.iter().zip(b_bytes.iter()) {
        res |= x ^ y;
    }
    res == 0
}

pub async fn require_key(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let provided = req
        .headers()
        .get("x-data-key")
        .and_then(|value| value.to_str().ok());
    match provided {
        Some(key) if !state.api_key.is_empty() && constant_time_eq(key, &state.api_key) => {
            next.run(req).await
        }
        _ => (StatusCode::UNAUTHORIZED, Json(json!({"error": "unauthorized"}))).into_response(),
    }
}

pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "postgres_pool": { "size": state.pool.size() }
    }))
}

#[derive(Debug, Deserialize)]
pub struct UserQuery {
    pub email: Option<String>,
    pub username: Option<String>,
    pub google_id: Option<String>,
    pub discord_id: Option<String>,
    pub telegram_id: Option<String>,
    pub apple_id: Option<String>,
}

pub async fn find_user(State(state): State<AppState>, Query(query): Query<UserQuery>) -> Response {
    let result = if let Some(email) = query.email.as_deref() {
        db::find_by_email(&state.pool, email).await
    } else if let Some(username) = query.username.as_deref() {
        db::find_by_username(&state.pool, username).await
    } else if let Some(id) = query.google_id.as_deref() {
        db::find_by_provider(&state.pool, "google", id).await
    } else if let Some(id) = query.discord_id.as_deref() {
        db::find_by_provider(&state.pool, "discord", id).await
    } else if let Some(id) = query.telegram_id.as_deref() {
        db::find_by_provider(&state.pool, "telegram", id).await
    } else if let Some(id) = query.apple_id.as_deref() {
        db::find_by_provider(&state.pool, "apple", id).await
    } else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "missing_lookup"}))).into_response();
    };
    match result {
        Ok(Some(user)) => (StatusCode::OK, Json(user_json(&user))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(error) => db_error(error),
    }
}

pub async fn get_user(State(state): State<AppState>, Path(id): Path<Uuid>) -> Response {
    match db::get_by_id(&state.pool, id).await {
        Ok(Some(user)) => (StatusCode::OK, Json(user_json(&user))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(error) => db_error(error),
    }
}

pub async fn create_user(State(state): State<AppState>, Json(body): Json<NewUser>) -> Response {
    match db::create_user(&state.pool, body).await {
        Ok(user) => (StatusCode::CREATED, Json(user_json(&user))).into_response(),
        Err(error) if db::is_unique_violation(&error) => {
            (StatusCode::CONFLICT, Json(json!({"error": "email_taken"}))).into_response()
        }
        Err(error) => db_error(error),
    }
}

pub async fn update_user(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UserPatch>,
) -> Response {
    if let Some(ref username) = body.username {
        match db::find_by_username(&state.pool, username).await {
            Ok(Some(existing)) if existing.id != id => {
                return (StatusCode::CONFLICT, Json(json!({"error": "username_taken"}))).into_response();
            }
            Ok(_) => {}
            Err(error) => return db_error(error),
        }
    }
    match db::patch_user(&state.pool, id, body).await {
        Ok(Some(user)) => (StatusCode::OK, Json(user_json(&user))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(error) if db::is_unique_violation(&error) => {
            (StatusCode::CONFLICT, Json(json!({"error": "conflict"}))).into_response()
        }
        Err(error) => db_error(error),
    }
}

pub async fn delete_user(State(state): State<AppState>, Path(id): Path<Uuid>) -> Response {
    match db::delete_user(&state.pool, id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(error) => db_error(error),
    }
}

pub async fn unlink_provider(State(state): State<AppState>, Path((id, provider)): Path<(Uuid, String)>) -> Response {
    if !matches!(provider.as_str(), "google" | "telegram") {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "unsupported_provider"}))).into_response();
    }
    match db::unlink_provider(&state.pool, id, &provider).await {
        Ok(Some(user)) => (StatusCode::OK, Json(user_json(&user))).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(error) => db_error(error),
    }
}

pub async fn oauth_upsert(State(state): State<AppState>, Json(body): Json<OAuthRequest>) -> Response {
    match db::oauth_upsert(&state.pool, body).await {
        Ok(Ok(user)) => (StatusCode::OK, Json(user_json(&user))).into_response(),
        Ok(Err(code)) => (StatusCode::CONFLICT, Json(json!({"error": code}))).into_response(),
        Err(error) if db::is_unique_violation(&error) => {
            (StatusCode::CONFLICT, Json(json!({"error": "oauth_failed"}))).into_response()
        }
        Err(error) => db_error(error),
    }
}

pub async fn get_profile(State(state): State<AppState>, Path(id): Path<Uuid>) -> Response {
    match db::get_profile(&state.pool, id).await {
        Ok(Some(profile)) => (StatusCode::OK, Json(profile.config)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(error) => db_error(error),
    }
}

pub async fn save_profile(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<ProfileWrite>,
) -> Response {
    match db::save_profile(&state.pool, id, body.config).await {
        Ok(profile) => (StatusCode::OK, Json(profile.config)).into_response(),
        Err(error) => db_error(error),
    }
}

fn user_json(user: &User) -> Value {
    serde_json::to_value(user).unwrap_or_else(|_| json!({"error": "serialize"}))
}

fn db_error(error: sqlx::Error) -> Response {
    tracing::error!(%error, "postgres error");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "database_error"})),
    )
        .into_response()
}
