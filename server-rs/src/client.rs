//! Outbound HTTPS client. rustls with the system trust store, so the scratch
//! image can set `SSL_CERT_FILE` to the copied CA bundle. Loopback health
//! checks use the same client.

use std::time::Duration;

/// Open-Meteo User-Agent. Later route ports send this on every upstream call.
pub const USER_AGENT: &str =
    "heavenly-weather/0.1 (andes-viewer; non-commercial; respect-rate-limits)";

pub fn build() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(4))
        .connect_timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

/// Open-Meteo fetch has no timeout in the TypeScript cache. Redirects stay off
/// so a free-tier URL cannot be bounced onto a customer host.
pub fn open_meteo() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}
