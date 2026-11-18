//! Weather desk server library. The binary in `main.rs` serves HTTP and runs
//! the scratch-image healthcheck. Route ports land in this crate.

pub mod airfields;
pub mod annex3;
pub mod app;
pub mod awc;
pub mod cache;
pub mod ceiling;
pub mod client;
pub mod desk;
pub mod domain;
pub mod field;
pub mod health;
pub mod js_json;
pub mod metar;
pub mod metar_wx;
pub mod models;
pub mod msa;
pub mod official_cache;
pub mod official_ifis;
pub mod official_routes;
pub mod product;
pub mod product_log;
pub mod regrid;
pub mod rmk;
pub mod round;
pub mod routes;
pub mod series;
pub mod state;
pub mod static_files;
pub mod stations;
pub mod taf;
pub mod taf_format;
pub mod utc;
pub mod vis_wx;
pub mod visibility;

#[cfg(test)]
mod desk_parity;
#[cfg(test)]
mod encoder_tests;
#[cfg(test)]
mod official_parity;
#[cfg(test)]
mod parity;
#[cfg(test)]
mod parity_eval;
#[cfg(test)]
mod route_parity;
