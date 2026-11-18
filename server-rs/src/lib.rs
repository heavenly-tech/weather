//! Weather desk server library. The binary in `main.rs` serves HTTP and runs
//! the scratch-image healthcheck. Route ports land in this crate.

pub mod app;
pub mod ceiling;
pub mod client;
pub mod health;
pub mod js_json;
pub mod regrid;
pub mod round;
pub mod static_files;

#[cfg(test)]
mod parity;
#[cfg(test)]
mod parity_eval;
