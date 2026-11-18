use std::path::PathBuf;

use axum::routing::get;
use axum::Router;

use crate::desk;
use crate::health;
use crate::official_routes;
use crate::routes;
use crate::state::AppState;
use crate::static_files;

pub fn router(dist: PathBuf) -> Router {
    let state = AppState::production().expect("Open-Meteo client");
    router_with(dist, state)
}

pub fn router_with(dist: PathBuf, state: AppState) -> Router {
    let api = Router::new()
        .route("/api/health", get(health::get))
        .route("/api/andes/models", get(routes::models))
        .route("/api/andes/times", get(routes::times))
        .route("/api/andes/ceiling", get(routes::ceiling))
        .route("/api/andes/slice", get(routes::slice))
        .route("/api/andes/timeline", get(routes::timeline))
        .route("/api/andes/coherence", get(routes::coherence))
        .route("/api/generated/metar", get(routes::generated_metar))
        .route("/api/generated/taf", get(routes::generated_taf))
        .route("/api/config", get(desk::config))
        .route("/api/metar", get(desk::metar))
        .route("/api/taf", get(desk::taf))
        .route("/api/forecast", get(desk::forecast))
        .route("/api/gramet", get(desk::gramet))
        .route("/api/gamet", get(desk::gamet))
        .route("/api/synoptic", get(desk::synoptic))
        .route("/api/synoptic/image", get(desk::synoptic_image))
        .route("/api/viz", get(desk::viz))
        .route("/api/official/metar", get(official_routes::official_metar))
        .route("/api/official/taf", get(official_routes::official_taf))
        .route("/api/official/gamet", get(official_routes::official_gamet))
        .with_state(state);
    static_files::attach(api, &dist)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn bytes(response: axum::response::Response) -> Vec<u8> {
        response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes()
            .to_vec()
    }

    #[tokio::test]
    async fn health_response_matches_typescript_fixture() {
        let dist = tempfile::tempdir().unwrap();
        let response = router(dist.path().to_path_buf())
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .map(|value| value.as_bytes()),
            Some(&b"application/json"[..])
        );
        let fixture = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity/api-health.body"),
        )
        .unwrap();
        assert_eq!(bytes(response).await, fixture);
    }

    #[tokio::test]
    async fn static_file_and_index_fallback() {
        let dist = tempfile::tempdir().unwrap();
        let index = b"EXAMPLE index\n";
        let asset = b"EXAMPLE asset\n";
        std::fs::write(dist.path().join("index.html"), index).unwrap();
        std::fs::create_dir(dist.path().join("assets")).unwrap();
        std::fs::write(dist.path().join("assets/example.txt"), asset).unwrap();
        let app = router(dist.path().to_path_buf());

        let root = app
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(root.status(), StatusCode::OK);
        assert_eq!(bytes(root).await, index);

        let file = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/assets/example.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(file.status(), StatusCode::OK);
        assert_eq!(bytes(file).await, asset);

        let missing = app
            .oneshot(
                Request::builder()
                    .uri("/no-such-page")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::OK);
        assert_eq!(bytes(missing).await, index);
    }

    #[tokio::test]
    async fn missing_dist_is_not_found_and_health_still_answers() {
        let dist = tempfile::tempdir().unwrap();
        let empty = dist.path().join("does-not-exist");
        let app = router(empty);

        let health = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);

        let page = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(page.status(), StatusCode::NOT_FOUND);
    }
}
