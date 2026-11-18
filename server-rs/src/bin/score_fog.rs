//! Score one model series for the old FG rule, the new FG rule, and PROB30.
//!
//! stdin JSON: `{"icao","model","hourly"}`. stdout is
//! `time<TAB>old<TAB>new<TAB>risk<TAB>night` with 1 when that rule fires. Old is the
//! previous visibility gate (coded visibility below 1000 m). New is that gate
//! plus night, T−Td ≤ 1 °C, wind ≤ 5 kt, and a saturated lowest level.
//! `risk` is PROB30 BR/FG: night, T−Td ≤ 2 °C, and wind ≤ 5 kt.

use std::io::Read;

use serde_json::Value;
use weather::annex3::kmh_to_kt;
use weather::ceiling::ceiling_from_hourly;
use weather::metar_wx::derive_metar_wx_and_cloud;
use weather::round::js_round;
use weather::series::Series;
use weather::stations;
use weather::vis_wx::{fog_risk, is_night};
use weather::visibility::resolve_visibility_meters;

fn main() {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .expect("read score input");
    let value: Value = serde_json::from_str(&raw).expect("score input json");
    let icao = value["icao"].as_str().expect("icao");
    let model = value["model"].as_str().expect("model");
    let elev = stations::require_station(icao).elev_m;
    let series = Series::from_json(&value["hourly"]);
    for index in 0..series.time_len() {
        let resolved = resolve_visibility_meters(&series, index, Some(model));
        let vis = resolved.vis_m.map(js_round);
        let ceil = ceiling_from_hourly(&series.hourly, index, elev);
        let derived = derive_metar_wx_and_cloud(
            &series,
            index,
            elev,
            icao,
            &ceil,
            vis,
            false,
            resolved.estimated,
            Some(model),
        );
        let old = derived.vis_m.is_some_and(|metres| metres < 1000.0);
        let new_fg = derived
            .weather
            .split_whitespace()
            .any(|token| token == "FG");
        let temp = series.num("temperature_2m", index);
        let dew = series.num("dew_point_2m", index);
        let spread = match (temp, dew) {
            (Some(temp), Some(dew)) => Some(temp - dew),
            _ => None,
        };
        let night = is_night(icao, &series.time[index]);
        let risk = fog_risk(
            night,
            spread,
            kmh_to_kt(series.num("wind_speed_10m", index)),
        );
        println!(
            "{}\t{}\t{}\t{}\t{}",
            series.time[index],
            u8::from(old),
            u8::from(new_fg),
            u8::from(risk),
            u8::from(night)
        );
    }
}
