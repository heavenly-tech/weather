//! Weather desk server library. The binary in `main.rs` serves HTTP and runs
//! the scratch-image healthcheck. Route ports land in this crate.

pub mod annex3;
pub mod app;
pub mod ceiling;
pub mod client;
pub mod health;
pub mod js_json;
pub mod metar;
pub mod metar_wx;
pub mod msa;
pub mod product;
pub mod regrid;
pub mod rmk;
pub mod round;
pub mod series;
pub mod static_files;
pub mod taf;
pub mod taf_format;
pub mod utc;
pub mod vis_wx;
pub mod visibility;

#[cfg(test)]
mod encoder_tests;
#[cfg(test)]
mod parity;
#[cfg(test)]
mod parity_eval;
