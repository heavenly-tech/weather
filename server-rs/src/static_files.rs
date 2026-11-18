//! Files under the dist directory. Vite fills this in a later PR; until then
//! the image carries a placeholder `index.html`. Unknown paths fall back to
//! that file when it exists, which is how the client routes will be served.

use std::path::Path;

use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

pub fn attach(router: Router, dist: &Path) -> Router {
    // `fallback` keeps ServeFile's 200. `not_found_service` would force 404,
    // which breaks the client-route index fallback.
    let files = ServeDir::new(dist)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(dist.join("index.html")));
    router.fallback_service(files)
}
