//! Andes viewer airfields. SCVH is the published Chacabuco ARP.

#[derive(Clone, Copy, Debug)]
pub struct AndesAirfield {
    pub icao: &'static str,
    pub name: &'static str,
    pub lat: f64,
    pub lon: f64,
    pub elev_m: f64,
    pub has_metar: bool,
    pub nearest_metar_icao: Option<&'static str>,
}

pub fn airfields() -> Vec<AndesAirfield> {
    vec![
        AndesAirfield {
            icao: "SCTB",
            name: "Eulogio Sánchez / Tobalaba",
            lat: -33.456,
            lon: -70.546,
            elev_m: 649.0,
            has_metar: false,
            nearest_metar_icao: Some("SCEL"),
        },
        AndesAirfield {
            icao: "SCEL",
            name: "Arturo Merino Benítez",
            lat: -33.393,
            lon: -70.786,
            elev_m: 474.0,
            has_metar: true,
            nearest_metar_icao: None,
        },
        AndesAirfield {
            icao: "SCVM",
            name: "Viña del Mar / Torquemada",
            lat: -32.95,
            lon: -71.479,
            elev_m: 141.0,
            has_metar: true,
            nearest_metar_icao: None,
        },
        AndesAirfield {
            icao: "SCVH",
            name: "La Victoria de Chacabuco",
            lat: -(33.0 + 3.0 / 60.0 + 3.0 / 3600.0),
            lon: -(70.0 + 42.0 / 60.0 + 32.0 / 3600.0),
            elev_m: 652.0,
            has_metar: false,
            nearest_metar_icao: None,
        },
        AndesAirfield {
            icao: "SCPD",
            name: "Peldehue",
            lat: -33.117,
            lon: -70.684,
            elev_m: 360.0,
            has_metar: true,
            nearest_metar_icao: None,
        },
    ]
}

pub fn airfield(icao: &str) -> Option<AndesAirfield> {
    airfields()
        .into_iter()
        .find(|field| field.icao.eq_ignore_ascii_case(icao))
}

pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R_KM: f64 = 6371.0;
    let to_rad = |degrees: f64| degrees * std::f64::consts::PI / 180.0;
    let d_lat = to_rad(lat2 - lat1);
    let d_lon = to_rad(lon2 - lon1);
    let a = (d_lat / 2.0).sin().powi(2)
        + to_rad(lat1).cos() * to_rad(lat2).cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * R_KM * (a.sqrt().min(1.0)).asin()
}
