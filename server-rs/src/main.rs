use std::ffi::OsStr;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::ExitCode;

const DEFAULT_PORT: u16 = 4310;
const DEFAULT_DIST: &str = "/app/dist";

enum Command {
    Serve,
    Healthcheck,
}

fn parse_args<I>(args: I) -> Result<Command, String>
where
    I: IntoIterator,
    I::Item: AsRef<OsStr>,
{
    let mut args = args.into_iter();
    let Some(raw) = args.next() else {
        return Ok(Command::Serve);
    };
    let cmd = raw.as_ref();
    if cmd == "serve" {
        if args.next().is_some() {
            return Err("serve takes no arguments".to_string());
        }
        return Ok(Command::Serve);
    }
    if cmd == "healthcheck" {
        if args.next().is_some() {
            return Err("healthcheck takes no arguments".to_string());
        }
        return Ok(Command::Healthcheck);
    }
    Err(format!(
        "unknown command {}\nusage: weather [serve|healthcheck]",
        cmd.to_string_lossy()
    ))
}

fn port_from_env() -> Result<u16, String> {
    match std::env::var("PORT") {
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_PORT),
        Err(err) => Err(err.to_string()),
        Ok(raw) => raw
            .parse::<u16>()
            .map_err(|_| format!("PORT is not a u16: {raw}")),
    }
}

fn dist_dir() -> PathBuf {
    std::env::var_os("WEATHER_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_DIST))
}

async fn serve() -> Result<(), String> {
    let port = port_from_env()?;
    let dist = dist_dir();
    let app = weather::app::router(dist);
    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|err| format!("bind {addr}: {err}"))?;
    eprintln!("weather listening on {port}");
    axum::serve(listener, app)
        .await
        .map_err(|err| format!("serve: {err}"))?;
    Ok(())
}

fn main() -> ExitCode {
    match parse_args(std::env::args_os().skip(1)) {
        Ok(Command::Serve) => {
            let runtime = match tokio::runtime::Runtime::new() {
                Ok(runtime) => runtime,
                Err(err) => {
                    eprintln!("serve: {err}");
                    return ExitCode::from(1);
                }
            };
            if let Err(err) = runtime.block_on(serve()) {
                eprintln!("serve: {err}");
                return ExitCode::from(1);
            }
            ExitCode::SUCCESS
        }
        Ok(Command::Healthcheck) => {
            let port = match port_from_env() {
                Ok(port) => port,
                Err(err) => {
                    eprintln!("healthcheck: {err}");
                    return ExitCode::from(1);
                }
            };
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(err) => {
                    eprintln!("healthcheck: {err}");
                    return ExitCode::from(1);
                }
            };
            if runtime.block_on(weather::health::probe(port)) {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        Err(err) => {
            eprintln!("{err}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_command_is_serve() {
        let parsed = parse_args(std::iter::empty::<&str>()).unwrap();
        assert!(matches!(parsed, Command::Serve));
        assert!(matches!(parse_args(["serve"]).unwrap(), Command::Serve));
    }

    #[test]
    fn healthcheck_command() {
        assert!(matches!(
            parse_args(["healthcheck"]).unwrap(),
            Command::Healthcheck
        ));
    }

    #[test]
    fn unknown_command_and_extra_args_are_rejected() {
        assert!(parse_args(["healthchek"]).is_err());
        assert!(parse_args(["serve", "now"]).is_err());
        assert!(parse_args(["healthcheck", "now"]).is_err());
    }

    #[test]
    fn port_defaults_and_rejects_garbage() {
        let previous = std::env::var_os("PORT");
        std::env::remove_var("PORT");
        assert_eq!(port_from_env().unwrap(), DEFAULT_PORT);
        std::env::set_var("PORT", "4310");
        assert_eq!(port_from_env().unwrap(), 4310);
        std::env::set_var("PORT", "nope");
        assert!(port_from_env().is_err());
        match previous {
            Some(value) => std::env::set_var("PORT", value),
            None => std::env::remove_var("PORT"),
        }
    }

    #[tokio::test]
    async fn healthcheck_probes_a_live_server_and_a_closed_port() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let dist = tempfile::tempdir().unwrap();
        let app = weather::app::router(dist.path().to_path_buf());
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut healthy = false;
        for _ in 0..20 {
            if weather::health::probe(port).await {
                healthy = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(healthy, "probe did not see ok:true");

        let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        assert!(!weather::health::probe(closed_port).await);
    }
}
