//! Files under the Vite `dist` directory. Client routes fall back to
//! `index.html`. Hashed asset names get a long immutable cache. Other files
//! revalidate.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::Router;

pub fn attach(router: Router, dist: &Path) -> Router {
    let dist = dist.to_path_buf();
    router.fallback(move |request: Request| {
        let dist = dist.clone();
        async move { serve(&dist, request.uri().path()) }
    })
}

fn serve(dist: &Path, url_path: &str) -> Response {
    if let Some(path) = safe_file(dist, url_path) {
        return file_response(&path, cache_control(&path));
    }
    let index = dist.join("index.html");
    if index.is_file() {
        return file_response(&index, "no-cache");
    }
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::empty())
        .expect("response")
}

fn safe_file(dist: &Path, url_path: &str) -> Option<PathBuf> {
    let rel = url_path.trim_start_matches('/');
    if rel.is_empty()
        || rel
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    let dist = dist.canonicalize().ok()?;
    let candidate = dist.join(rel);
    let file = candidate.canonicalize().ok()?;
    if file.starts_with(&dist) && file.is_file() {
        Some(file)
    } else {
        None
    }
}

/// HTML only. API responses are not served here, so this header is not on `/api`.
/// `connect-src` is `'self'` plus the OSM tile host: desk data is fetched from `/api`,
/// and the globe loads tiles from that host. `style-src` allows inline style attributes
/// that Cesium writes onto its widget. `script-src` has no `'unsafe-eval'`.
pub const HTML_CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://tile.openstreetmap.org; font-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";

fn file_response(path: &Path, cache: &'static str) -> Response {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty())
                .expect("response");
        }
    };
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type(path))
        .header(header::CACHE_CONTROL, cache);
    if path.extension().and_then(|ext| ext.to_str()) == Some("html") {
        response = response.header(header::CONTENT_SECURITY_POLICY, HTML_CSP);
    }
    response.body(Body::from(bytes)).expect("response")
}

fn cache_control(path: &Path) -> &'static str {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if is_hashed_asset(name) {
        "public, max-age=31536000, immutable"
    } else if name.ends_with(".html") {
        "no-cache"
    } else {
        "public, max-age=3600"
    }
}

fn is_hashed_asset(name: &str) -> bool {
    let stem = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
    let Some((_, hash)) = stem.rsplit_once('-') else {
        return false;
    };
    hash.len() >= 8
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn body(response: Response) -> Vec<u8> {
        response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes()
            .to_vec()
    }

    #[tokio::test]
    async fn index_hashed_asset_and_spa_fallback() {
        let dist = tempfile::tempdir().unwrap();
        let index = b"<!doctype html><div id=\"root\"></div>\n";
        let asset = b"console.log('desk')\n";
        std::fs::write(dist.path().join("index.html"), index).unwrap();
        std::fs::create_dir(dist.path().join("assets")).unwrap();
        std::fs::write(dist.path().join("assets/index-Ab12cd34.js"), asset).unwrap();
        let app = attach(Router::new(), dist.path());

        let root = app
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(root.status(), StatusCode::OK);
        assert_eq!(
            root.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
        assert_eq!(
            root.headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
            Some("no-cache")
        );
        assert_eq!(
            root.headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .and_then(|v| v.to_str().ok()),
            Some(HTML_CSP)
        );
        assert!(!HTML_CSP.contains("'unsafe-eval'"));
        assert_eq!(body(root).await, index);

        let hashed = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/assets/index-Ab12cd34.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(hashed.status(), StatusCode::OK);
        assert_eq!(
            hashed
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("text/javascript; charset=utf-8")
        );
        assert_eq!(
            hashed
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
            Some("public, max-age=31536000, immutable")
        );
        assert!(hashed
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .is_none());
        assert_eq!(body(hashed).await, asset);

        let spa = app
            .oneshot(
                Request::builder()
                    .uri("/metar-taf")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(spa.status(), StatusCode::OK);
        assert_eq!(
            spa.headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
        assert_eq!(
            spa.headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .and_then(|v| v.to_str().ok()),
            Some(HTML_CSP)
        );
        assert_eq!(body(spa).await, index);
    }
}
