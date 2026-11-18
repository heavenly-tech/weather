//! Station table used when a generated product is not an Andes airfield.
//! An unknown ICAO falls back to SCEL, matching `requireStation`.

#[derive(Clone, Copy, Debug)]
pub struct Station {
    pub icao: &'static str,
    pub name: &'static str,
    pub city: &'static str,
    pub lat: f64,
    pub lon: f64,
    pub elev_m: f64,
}

const STATIONS: &[Station] = &[
    Station {
        icao: "SCAR",
        name: "Chacalluta",
        city: "Arica",
        lat: -18.348,
        lon: -70.339,
        elev_m: 51.0,
    },
    Station {
        icao: "SCDA",
        name: "Diego Aracena",
        city: "Iquique",
        lat: -20.535,
        lon: -70.181,
        elev_m: 48.0,
    },
    Station {
        icao: "SCCF",
        name: "El Loa",
        city: "Calama",
        lat: -22.498,
        lon: -68.908,
        elev_m: 2293.0,
    },
    Station {
        icao: "SCFA",
        name: "Cerro Moreno",
        city: "Antofagasta",
        lat: -23.444,
        lon: -70.445,
        elev_m: 139.0,
    },
    Station {
        icao: "SCAT",
        name: "Desierto de Atacama",
        city: "Copiapó",
        lat: -27.261,
        lon: -70.779,
        elev_m: 204.0,
    },
    Station {
        icao: "SCSE",
        name: "La Florida",
        city: "La Serena",
        lat: -29.916,
        lon: -71.199,
        elev_m: 146.0,
    },
    Station {
        icao: "SCVM",
        name: "Viña del Mar",
        city: "Viña del Mar",
        lat: -32.95,
        lon: -71.479,
        elev_m: 141.0,
    },
    Station {
        icao: "SCEL",
        name: "Arturo Merino Benítez",
        city: "Santiago",
        lat: -33.393,
        lon: -70.786,
        elev_m: 474.0,
    },
    Station {
        icao: "SCTB",
        name: "Eulogio Sánchez",
        city: "Tobalaba",
        lat: -33.456,
        lon: -70.546,
        elev_m: 649.0,
    },
    Station {
        icao: "SCSN",
        name: "Santo Domingo",
        city: "Santo Domingo",
        lat: -33.655,
        lon: -71.614,
        elev_m: 77.0,
    },
    Station {
        icao: "SCIE",
        name: "Carriel Sur",
        city: "Concepción",
        lat: -36.773,
        lon: -73.063,
        elev_m: 8.0,
    },
    Station {
        icao: "SCQP",
        name: "La Araucanía",
        city: "Temuco",
        lat: -38.767,
        lon: -72.637,
        elev_m: 92.0,
    },
    Station {
        icao: "SCVD",
        name: "Pichoy",
        city: "Valdivia",
        lat: -39.65,
        lon: -73.086,
        elev_m: 18.0,
    },
    Station {
        icao: "SCJO",
        name: "Cañal Bajo",
        city: "Osorno",
        lat: -40.611,
        lon: -73.061,
        elev_m: 59.0,
    },
    Station {
        icao: "SCTE",
        name: "El Tepual",
        city: "Puerto Montt",
        lat: -41.439,
        lon: -73.094,
        elev_m: 90.0,
    },
    Station {
        icao: "SCBA",
        name: "Balmaceda",
        city: "Balmaceda",
        lat: -45.916,
        lon: -71.689,
        elev_m: 520.0,
    },
    Station {
        icao: "SCNT",
        name: "Teniente Gallardo",
        city: "Puerto Natales",
        lat: -51.671,
        lon: -72.529,
        elev_m: 67.0,
    },
    Station {
        icao: "SCCI",
        name: "Carlos Ibáñez",
        city: "Punta Arenas",
        lat: -53.002,
        lon: -70.855,
        elev_m: 38.0,
    },
    Station {
        icao: "SCIP",
        name: "Mataveri",
        city: "Isla de Pascua",
        lat: -27.165,
        lon: -109.427,
        elev_m: 48.0,
    },
    Station {
        icao: "SPJC",
        name: "Jorge Chávez",
        city: "Lima",
        lat: -12.022,
        lon: -77.114,
        elev_m: 34.0,
    },
    Station {
        icao: "SAEZ",
        name: "Ministro Pistarini",
        city: "Ezeiza",
        lat: -34.822,
        lon: -58.536,
        elev_m: 21.0,
    },
];

pub fn station(icao: &str) -> Option<&'static Station> {
    STATIONS
        .iter()
        .find(|station| station.icao.eq_ignore_ascii_case(icao))
}

pub fn require_station(icao: &str) -> &'static Station {
    station(icao).unwrap_or_else(|| station("SCEL").expect("SCEL is in the station table"))
}
