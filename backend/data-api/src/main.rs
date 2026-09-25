use anyhow::{Context, Result};
use prostgres_db::{api, db, features};
use api::AppState;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{get, post};
use axum::Router;
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .compact()
        .init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let max_connections = std::env::var("DATABASE_MAX_CONNECTIONS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(10)
        .clamp(1, 20);
    // Vercel injects PORT for container functions. Keep LISTEN_ADDR as an
    // explicit override for Docker/VM deployments, then fall back to PORT.
    let listen = std::env::var("LISTEN_ADDR")
        .or_else(|_| std::env::var("PORT").map(|port| format!("0.0.0.0:{port}")))
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let api_key = std::env::var("DATA_API_KEY").context("DATA_API_KEY is required")?;
    if api_key.trim().is_empty() {
        anyhow::bail!("DATA_API_KEY is required and cannot be empty");
    }

    tracing::info!(max_connections, "connecting to postgres");
    let pool = db::connect(&database_url, max_connections).await?;
    db::migrate(&pool).await?;
    tracing::info!("postgres ready");

    let state = AppState { pool, api_key };
    let protected = Router::new()
        .route("/v1/users", post(api::create_user).get(api::find_user))
        .route("/v1/users/oauth", post(api::oauth_upsert))
        .route("/v1/users/{id}/providers/{provider}", post(api::unlink_provider))
        .route("/v1/users/{id}", get(api::get_user).patch(api::update_user).delete(api::delete_user))
        .route("/v1/profiles/{id}", get(api::get_profile).put(api::save_profile))
        .merge(features::router())
        .layer(middleware::from_fn_with_state(state.clone(), api::require_key));

    let app = Router::new()
        .route("/health", get(api::health))
        .merge(protected)
        .layer(DefaultBodyLimit::max(150 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = listen.parse().context("invalid LISTEN_ADDR")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "prostgres_db listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutting down");
}
