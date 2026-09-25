pub mod alive;
pub mod archive;
pub mod asks;
pub mod capsule;
pub mod draw;
pub mod drawings;
pub mod guestbook;
pub mod helpers;
pub mod hits;
pub mod moon;
pub mod neighbours;
pub mod night;
pub mod reverse;
pub mod schema;
pub mod secret;
pub mod tally;

use crate::api::AppState;
use axum::routing::{get, post};
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/v1/features/{user_id}/guestbook",
            get(guestbook::list).post(guestbook::submit),
        )
        .route(
            "/v1/features/{user_id}/guestbook/inbox",
            get(guestbook::inbox),
        )
        .route(
            "/v1/features/{user_id}/guestbook/{id}/approve",
            post(guestbook::approve),
        )
        .route(
            "/v1/features/{user_id}/guestbook/{id}/reject",
            post(guestbook::reject),
        )
        .route(
            "/v1/features/{user_id}/guestbook/{id}/remove",
            post(guestbook::remove),
        )
        .route(
            "/v1/features/{user_id}/guestbook/{id}/pin",
            post(guestbook::pin),
        )
        .route(
            "/v1/features/{user_id}/asks",
            get(asks::list).post(asks::submit),
        )
        .route(
            "/v1/features/{user_id}/asks/inbox",
            get(asks::inbox),
        )
        .route(
            "/v1/features/{user_id}/asks/{id}/publish",
            post(asks::publish),
        )
        .route(
            "/v1/features/{user_id}/asks/{id}/draft",
            post(asks::draft),
        )
        .route(
            "/v1/features/{user_id}/asks/{id}/reject",
            post(asks::reject),
        )
        .route(
            "/v1/features/{user_id}/asks/{id}/remove",
            post(asks::remove),
        )
        .route(
            "/v1/features/{user_id}/drawings",
            get(drawings::gallery).post(drawings::submit),
        )
        .route(
            "/v1/features/{user_id}/drawings/board",
            get(drawings::board),
        )
        .route(
            "/v1/features/{user_id}/drawings/{id}/keep",
            post(drawings::keep),
        )
        .route(
            "/v1/features/{user_id}/drawings/{id}/reject",
            post(drawings::reject),
        )
        .route(
            "/v1/features/{user_id}/drawings/{id}/pin",
            post(drawings::pin),
        )
        .route(
            "/v1/features/{user_id}/neighbours",
            get(neighbours::owner_view).post(neighbours::nominate),
        )
        .route(
            "/v1/features/{user_id}/neighbours/public",
            get(neighbours::public_view),
        )
        .route(
            "/v1/features/{user_id}/neighbours/{to_username}/remove",
            post(neighbours::remove),
        )
        .route(
            "/v1/features/{user_id}/moon",
            get(moon::view),
        )
        .route(
            "/v1/features/{user_id}/night",
            get(night::view),
        )
        .route(
            "/v1/features/{user_id}/capsule",
            get(capsule::public_view),
        )
        .route(
            "/v1/features/{user_id}/capsule/publish",
            post(capsule::publish),
        )
        .route(
            "/v1/features/{user_id}/capsule/unpublish",
            post(capsule::unpublish),
        )
        .route(
            "/v1/features/{user_id}/tally",
            get(tally::current).post(tally::publish),
        )
        .route(
            "/v1/features/{user_id}/tally/vote",
            post(tally::vote),
        )
        .route(
            "/v1/features/{user_id}/tally/close",
            post(tally::close),
        )
        .route(
            "/v1/features/{user_id}/tally/reopen",
            post(tally::reopen),
        )
        .route(
            "/v1/features/{user_id}/tally/reset",
            post(tally::reset),
        )
        .route(
            "/v1/features/{user_id}/secret",
            post(secret::attempt),
        )
        .route(
            "/v1/features/{user_id}/secret/grant/{grant}",
            get(secret::resolve),
        )
        .route(
            "/v1/features/{user_id}/secret/set",
            post(secret::set),
        )
        .route(
            "/v1/features/{user_id}/secret/clear",
            post(secret::clear),
        )
        .route(
            "/v1/features/{user_id}/archive",
            get(archive::list).post(archive::capture),
        )
        .route(
            "/v1/features/{user_id}/archive/{seq}",
            get(archive::get),
        )
        .route(
            "/v1/features/{user_id}/archive/{seq}/restore",
            post(archive::restore),
        )
        .route(
            "/v1/features/{user_id}/draw",
            get(draw::view),
        )
        .route(
            "/v1/features/{user_id}/alive",
            post(alive::heartbeat),
        )
        .route(
            "/v1/features/{user_id}/alive/count",
            get(alive::count),
        )
        .route(
            "/v1/features/{user_id}/alive/snuff",
            post(alive::snuff),
        )
        .route(
            "/v1/features/{user_id}/hits",
            get(hits::view).post(hits::record),
        )
        .route(
            "/v1/features/{user_id}/reverse",
            get(reverse::get).put(reverse::set),
        )
}