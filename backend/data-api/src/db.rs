use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Transaction};
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

const USER_COLUMNS: &str = "id, account_id, email, email_verified, password_hash, username, display_name, \
     avatar_url, google_id, discord_id, telegram_id, telegram_username, apple_id, \
     created_at, updated_at, last_login_at, is_admin, suspended_at, suspension_reason, suspended_until";

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub account_id: String,
    pub email: Option<String>,
    pub email_verified: bool,
    #[serde(skip_serializing)]
    pub password_hash: Option<String>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub google_id: Option<String>,
    pub discord_id: Option<String>,
    pub telegram_id: Option<String>,
    pub telegram_username: Option<String>,
    pub apple_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub is_admin: bool,
    pub suspended_at: Option<DateTime<Utc>>,
    pub suspension_reason: Option<String>,
    pub suspended_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct NewUser {
    pub email: Option<String>,
    pub email_verified: Option<bool>,
    pub password_hash: Option<String>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub google_id: Option<String>,
    pub discord_id: Option<String>,
    pub telegram_id: Option<String>,
    pub telegram_username: Option<String>,
    pub apple_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct UserPatch {
    pub email: Option<String>,
    pub email_verified: Option<bool>,
    pub password_hash: Option<String>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub google_id: Option<String>,
    pub discord_id: Option<String>,
    pub telegram_id: Option<String>,
    pub telegram_username: Option<String>,
    pub apple_id: Option<String>,
    pub touch_login: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct OAuthRequest {
    pub provider: String,
    pub provider_id: String,
    pub email: Option<String>,
    pub email_verified: Option<bool>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub telegram_username: Option<String>,
    pub current_user_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ProfileWrite {
    pub config: Value,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ProfileRow {
    pub user_id: Uuid,
    pub config: Value,
    pub updated_at: DateTime<Utc>,
}

pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool> {
    let max_connections = max_connections.clamp(1, 20);
    let mut options = PgConnectOptions::from_str(database_url).context("invalid DATABASE_URL")?;
    let sslmode = database_url
        .split(['?', '&'])
        .find_map(|part| part.strip_prefix("sslmode="))
        .unwrap_or("require");
    options = options.ssl_mode(parse_ssl_mode(sslmode));
    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(300))
        .test_before_acquire(true)
        .connect_with(options)
        .await
        .context("failed to connect to postgres")
}

fn parse_ssl_mode(mode: &str) -> PgSslMode {
    match mode.to_ascii_lowercase().as_str() {
        "disable" => PgSslMode::Disable,
        "allow" => PgSslMode::Allow,
        "prefer" => PgSslMode::Prefer,
        "verify-ca" => PgSslMode::VerifyCa,
        "verify-full" => PgSslMode::VerifyFull,
        _ => PgSslMode::Require,
    }
}

pub async fn migrate(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            account_id VARCHAR(16),
            email VARCHAR(320) UNIQUE,
            email_verified BOOLEAN NOT NULL DEFAULT FALSE,
            password_hash TEXT,
            username VARCHAR(32) UNIQUE,
            display_name VARCHAR(128),
            avatar_url TEXT,
            google_id VARCHAR(64) UNIQUE,
            discord_id VARCHAR(32) UNIQUE,
            telegram_id VARCHAR(32) UNIQUE,
            telegram_username VARCHAR(64),
            apple_id VARCHAR(128) UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login_at TIMESTAMPTZ
        )
        "#,
    )
    .execute(pool)
    .await?;
    for statement in [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id VARCHAR(128) UNIQUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id VARCHAR(16)",
        "CREATE UNIQUE INDEX IF NOT EXISTS users_account_id_unique_idx ON users (account_id) WHERE account_id IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ",
        "CREATE TABLE IF NOT EXISTS profiles (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            config JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ",
        "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disabled_reason TEXT",
        "CREATE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username))",
        "CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique_idx ON users (LOWER(username)) WHERE username IS NOT NULL",
        "CREATE TABLE IF NOT EXISTS reserved_usernames (
            username VARCHAR(32) PRIMARY KEY,
            reason TEXT,
            created_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS badges (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            color VARCHAR(32) NOT NULL DEFAULT '#9b87f5',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS user_badges (
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            badge_id VARCHAR(64) NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            granted_by UUID,
            granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, badge_id)
        )",
        "CREATE TABLE IF NOT EXISTS premium_entitlements (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            plan VARCHAR(64) NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            expires_at TIMESTAMPTZ,
            granted_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS reports (
            id UUID PRIMARY KEY,
            reporter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            target_username VARCHAR(32),
            reason VARCHAR(128) NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            status VARCHAR(32) NOT NULL DEFAULT 'open',
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS feature_flags (
            key VARCHAR(128) PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            description TEXT NOT NULL DEFAULT '',
            updated_by UUID,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGSERIAL PRIMARY KEY,
            actor_user_id UUID,
            action VARCHAR(128) NOT NULL,
            target_type VARCHAR(64),
            target_id VARCHAR(128),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS bakaboost_connections (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            provider VARCHAR(64) NOT NULL,
            external_id VARCHAR(128),
            status VARCHAR(32) NOT NULL DEFAULT 'connected',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            connected_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE TABLE IF NOT EXISTS theme_presets (
            id UUID PRIMARY KEY,
            name VARCHAR(128) NOT NULL UNIQUE,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by UUID,
            updated_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
        "CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC)",
    ] {
        sqlx::query(statement).execute(pool).await?;
    }
    crate::features::schema::registers(pool).await?;
    ensure_account_ids(pool).await?;
    sqlx::query("ALTER TABLE users ALTER COLUMN account_id SET NOT NULL").execute(pool).await?;
    Ok(())
}

fn account_id_for() -> String {
    // This public ID is independent from the internal UUID used by auth and relations.
    let value = 100_000_000_000u128 + (Uuid::new_v4().as_u128() % 900_000_000_000u128);
    value.to_string()
}

async fn ensure_account_ids(pool: &PgPool) -> Result<()> {
    // Replace old MISA-... public IDs without changing users.id or any relationships.
    let users = sqlx::query("SELECT id FROM users WHERE account_id IS NULL OR account_id !~ '^[0-9]{12}$'")
        .fetch_all(pool)
        .await?;
    for row in users {
        let id: Uuid = sqlx::Row::try_get(&row, "id")?;
        let mut updated = false;
        for _ in 0..32 {
            let candidate = account_id_for();
            match sqlx::query("UPDATE users SET account_id = $1, updated_at = NOW() WHERE id = $2")
                .bind(candidate)
                .bind(id)
                .execute(pool)
                .await
            {
                Ok(_) => { updated = true; break; }
                Err(sqlx::Error::Database(error)) if error.code().as_deref() == Some("23505") => continue,
                Err(error) => return Err(error.into()),
            }
        }
        if !updated { anyhow::bail!("could not allocate a unique numeric account id") }
    }
    Ok(())
}

pub async fn get_profile(pool: &PgPool, user_id: Uuid) -> Result<Option<ProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, ProfileRow>(
        "SELECT user_id, config, updated_at FROM profiles WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn save_profile(pool: &PgPool, user_id: Uuid, config: Value) -> Result<ProfileRow, sqlx::Error> {
    sqlx::query_as::<_, ProfileRow>(
        "INSERT INTO profiles (user_id, config, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
         RETURNING user_id, config, updated_at",
    )
    .bind(user_id)
    .bind(config)
    .fetch_one(pool)
    .await
}

pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {USER_COLUMNS} FROM users WHERE email = $1"))
        .bind(email)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_username(pool: &PgPool, username: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {USER_COLUMNS} FROM users WHERE username = $1"))
        .bind(username)
        .fetch_optional(pool)
        .await
}

pub async fn find_by_provider(
    pool: &PgPool,
    provider: &str,
    provider_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    let sql = match provider {
        "google" => format!("SELECT {USER_COLUMNS} FROM users WHERE google_id = $1"),
        "discord" => format!("SELECT {USER_COLUMNS} FROM users WHERE discord_id = $1"),
        "telegram" => format!("SELECT {USER_COLUMNS} FROM users WHERE telegram_id = $1"),
        "apple" => format!("SELECT {USER_COLUMNS} FROM users WHERE apple_id = $1"),
        _ => return Ok(None),
    };
    sqlx::query_as::<_, User>(&sql)
        .bind(provider_id)
        .fetch_optional(pool)
        .await
}

async fn tx_by_id(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
}

async fn tx_by_email(
    tx: &mut Transaction<'_, Postgres>,
    email: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(&format!("SELECT {USER_COLUMNS} FROM users WHERE email = $1"))
        .bind(email)
        .fetch_optional(&mut **tx)
        .await
}

async fn tx_by_provider(
    tx: &mut Transaction<'_, Postgres>,
    provider: &str,
    provider_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    let sql = match provider {
        "google" => format!("SELECT {USER_COLUMNS} FROM users WHERE google_id = $1"),
        "discord" => format!("SELECT {USER_COLUMNS} FROM users WHERE discord_id = $1"),
        "telegram" => format!("SELECT {USER_COLUMNS} FROM users WHERE telegram_id = $1"),
        "apple" => format!("SELECT {USER_COLUMNS} FROM users WHERE apple_id = $1"),
        _ => return Ok(None),
    };
    sqlx::query_as::<_, User>(&sql)
        .bind(provider_id)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn create_user(pool: &PgPool, new_user: NewUser) -> Result<User, sqlx::Error> {
    let id = Uuid::new_v4();
    sqlx::query_as::<_, User>(&format!(
        "INSERT INTO users (
            id, account_id, email, email_verified, password_hash, username, display_name, avatar_url,
            google_id, discord_id, telegram_id, telegram_username, apple_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING {USER_COLUMNS}"
    ))
    .bind(id)
    .bind(account_id_for())
    .bind(new_user.email)
    .bind(new_user.email_verified.unwrap_or(false))
    .bind(new_user.password_hash)
    .bind(new_user.username)
    .bind(new_user.display_name)
    .bind(new_user.avatar_url)
    .bind(new_user.google_id)
    .bind(new_user.discord_id)
    .bind(new_user.telegram_id)
    .bind(new_user.telegram_username)
    .bind(new_user.apple_id)
    .fetch_one(pool)
    .await
}

pub async fn patch_user(pool: &PgPool, id: Uuid, patch: UserPatch) -> Result<Option<User>, sqlx::Error> {
    let mut builder = QueryBuilder::<Postgres>::new("UPDATE users SET updated_at = NOW()");
    if let Some(email) = &patch.email {
        builder.push(", email = ").push_bind(email);
    }
    if let Some(verified) = patch.email_verified {
        builder.push(", email_verified = ").push_bind(verified);
    }
    if let Some(password_hash) = &patch.password_hash {
        builder.push(", password_hash = ").push_bind(password_hash);
    }
    if let Some(username) = &patch.username {
        builder.push(", username = ").push_bind(username);
    }
    if let Some(display_name) = &patch.display_name {
        builder.push(", display_name = ").push_bind(display_name);
    }
    if let Some(avatar_url) = &patch.avatar_url {
        builder.push(", avatar_url = ").push_bind(avatar_url);
    }
    if let Some(google_id) = &patch.google_id {
        builder.push(", google_id = ").push_bind(google_id);
    }
    if let Some(discord_id) = &patch.discord_id {
        builder.push(", discord_id = ").push_bind(discord_id);
    }
    if let Some(telegram_id) = &patch.telegram_id {
        builder.push(", telegram_id = ").push_bind(telegram_id);
    }
    if let Some(telegram_username) = &patch.telegram_username {
        builder.push(", telegram_username = ").push_bind(telegram_username);
    }
    if let Some(apple_id) = &patch.apple_id {
        builder.push(", apple_id = ").push_bind(apple_id);
    }
    if patch.touch_login.unwrap_or(false) {
        builder.push(", last_login_at = NOW()");
    }
    builder.push(" WHERE id = ").push_bind(id);
    builder.push(" RETURNING ");
    builder.push(USER_COLUMNS);
    builder.build_query_as::<User>().fetch_optional(pool).await
}

pub async fn delete_user(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() == 1)
}

pub async fn unlink_provider(pool: &PgPool, id: Uuid, provider: &str) -> Result<Option<User>, sqlx::Error> {
    let (column, extra) = match provider {
        "google" => ("google_id", ""),
        "telegram" => ("telegram_id", ", telegram_username = NULL"),
        _ => return Ok(None),
    };
    let query = format!(
        "UPDATE users SET {column} = NULL{extra}, updated_at = NOW() WHERE id = $1 RETURNING {USER_COLUMNS}"
    );
    sqlx::query_as::<_, User>(&query)
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn oauth_upsert(pool: &PgPool, req: OAuthRequest) -> Result<Result<User, &'static str>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let existing = tx_by_provider(&mut tx, &req.provider, &req.provider_id).await?;

    if let Some(current_id) = req.current_user_id {
        if let Some(ref other) = existing {
            if other.id != current_id {
                return Ok(Err("already_linked"));
            }
        }
        if let Some(ref email) = req.email {
            if let Some(taken) = tx_by_email(&mut tx, email).await? {
                if taken.id != current_id {
                    return Ok(Err("email_taken"));
                }
            }
        }
        apply_provider_update(&mut tx, current_id, &req).await?;
        let user = tx_by_id(&mut tx, current_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        tx.commit().await?;
        return Ok(Ok(user));
    }

    if let Some(mut user) = existing {
        if user.display_name.is_none() {
            if let Some(ref name) = req.display_name {
                user.display_name = Some(name.clone());
            }
        }
        if user.avatar_url.is_none() {
            if let Some(ref avatar) = req.avatar_url {
                user.avatar_url = Some(avatar.clone());
            }
        }
        if req.provider == "telegram" {
            if let Some(ref username) = req.telegram_username {
                user.telegram_username = Some(username.clone());
            }
        }
        if req.email_verified.unwrap_or(false) && req.email.as_deref() == user.email.as_deref() {
            user.email_verified = true;
        }
        sqlx::query(
            "UPDATE users SET display_name = $2, avatar_url = $3, telegram_username = $4,
                email_verified = $5, updated_at = NOW()
             WHERE id = $1",
        )
        .bind(user.id)
        .bind(&user.display_name)
        .bind(&user.avatar_url)
        .bind(&user.telegram_username)
        .bind(user.email_verified)
        .execute(&mut *tx)
        .await?;
        let user = tx_by_id(&mut tx, user.id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        tx.commit().await?;
        return Ok(Ok(user));
    }

    if let Some(ref email) = req.email {
        if tx_by_email(&mut tx, email).await?.is_some() {
            return Ok(Err("account_exists"));
        }
    }

    let id = Uuid::new_v4();
    let (google_id, discord_id, telegram_id, apple_id) = match req.provider.as_str() {
        "google" => (Some(req.provider_id.clone()), None, None, None),
        "discord" => (None, Some(req.provider_id.clone()), None, None),
        "telegram" => (None, None, Some(req.provider_id.clone()), None),
        "apple" => (None, None, None, Some(req.provider_id.clone())),
        _ => return Ok(Err("unknown_provider")),
    };
    sqlx::query(
        "INSERT INTO users (
            id, account_id, email, email_verified, display_name, avatar_url,
            google_id, discord_id, telegram_id, telegram_username, apple_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(id)
    .bind(account_id_for())
    .bind(&req.email)
    .bind(req.email_verified.unwrap_or(false) && req.email.is_some())
    .bind(&req.display_name)
    .bind(&req.avatar_url)
    .bind(google_id)
    .bind(discord_id)
    .bind(telegram_id)
    .bind(if req.provider == "telegram" {
        req.telegram_username.clone()
    } else {
        None
    })
    .bind(apple_id)
    .execute(&mut *tx)
    .await?;
    let user = tx_by_id(&mut tx, id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    tx.commit().await?;
    Ok(Ok(user))
}

async fn apply_provider_update(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    req: &OAuthRequest,
) -> Result<(), sqlx::Error> {
    match req.provider.as_str() {
        "google" => {
            sqlx::query("UPDATE users SET google_id = $2, updated_at = NOW() WHERE id = $1")
                .bind(user_id)
                .bind(&req.provider_id)
                .execute(&mut **tx)
                .await?;
        }
        "discord" => {
            sqlx::query("UPDATE users SET discord_id = $2, updated_at = NOW() WHERE id = $1")
                .bind(user_id)
                .bind(&req.provider_id)
                .execute(&mut **tx)
                .await?;
        }
        "telegram" => {
            sqlx::query(
                "UPDATE users SET telegram_id = $2, telegram_username = COALESCE($3, telegram_username), updated_at = NOW() WHERE id = $1",
            )
            .bind(user_id)
            .bind(&req.provider_id)
            .bind(&req.telegram_username)
            .execute(&mut **tx)
            .await?;
        }
        "apple" => {
            sqlx::query("UPDATE users SET apple_id = $2, updated_at = NOW() WHERE id = $1")
                .bind(user_id)
                .bind(&req.provider_id)
                .execute(&mut **tx)
                .await?;
        }
        _ => {}
    }
    if let Some(ref email) = req.email {
        sqlx::query(
            "UPDATE users SET email = COALESCE(email, $2),
                email_verified = CASE
                    WHEN email IS NULL THEN $3
                    WHEN email = $2 AND $3 THEN TRUE
                    ELSE email_verified
                END,
                updated_at = NOW()
             WHERE id = $1",
        )
        .bind(user_id)
        .bind(email)
        .bind(req.email_verified.unwrap_or(false))
        .execute(&mut **tx)
        .await?;
    }
    if let Some(ref name) = req.display_name {
        sqlx::query(
            "UPDATE users SET display_name = COALESCE(display_name, $2), updated_at = NOW() WHERE id = $1",
        )
        .bind(user_id)
        .bind(name)
        .execute(&mut **tx)
        .await?;
    }
    if let Some(ref avatar) = req.avatar_url {
        sqlx::query(
            "UPDATE users SET avatar_url = COALESCE(avatar_url, $2), updated_at = NOW() WHERE id = $1",
        )
        .bind(user_id)
        .bind(avatar)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub fn is_unique_violation(err: &sqlx::Error) -> bool {
    matches!(
        err,
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505")
    )
}
