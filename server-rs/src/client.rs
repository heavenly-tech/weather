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

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn open_meteo_does_not_follow_redirects() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buf = [0_u8; 1024];
            let _ = std::io::Read::read(&mut socket, &mut buf);
            let raw = b"HTTP/1.1 302 Found\r\nLocation: https://customer-api.open-meteo.com/v1/forecast\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = std::io::Write::write_all(&mut socket, raw);
        });
        let client = super::open_meteo().unwrap();
        let response = client
            .get(format!("http://127.0.0.1:{port}/redirect"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
    }
}
