//! Weather desk server library. The binary in `main.rs` serves HTTP and runs
//! the scratch-image healthcheck. Route ports land in this crate.

pub mod app;
pub mod client;
pub mod health;
pub mod round;
pub mod static_files;

#[cfg(test)]
mod parity;
