//! Andes domain grid. Latitudes decrease with row. Elevations here are 0;
//! the fine grid reads the static elevation file.

pub const LAT_MIN: f64 = -34.8;
pub const LAT_MAX: f64 = -32.1;
pub const LON_MIN: f64 = -71.8;
pub const LON_MAX: f64 = -70.0;

pub const SCTB_LAT: f64 = -33.456;
pub const SCTB_LON: f64 = -70.546;

#[derive(Clone, Copy, Debug)]
pub struct GridPoint {
    pub lat: f64,
    pub lon: f64,
}

pub fn default_grid_shape() -> (usize, usize) {
    let rows = env_count("ANDES_GRID_ROWS", 11);
    let cols = env_count("ANDES_GRID_COLS", 8);
    (rows, cols)
}

pub fn domain_grid(rows: usize, cols: usize) -> Vec<GridPoint> {
    let mut points = Vec::with_capacity(rows * cols);
    let row_den = (rows as f64 - 1.0).max(1.0);
    let col_den = (cols as f64 - 1.0).max(1.0);
    for ri in 0..rows {
        let lat = LAT_MAX + (ri as f64 / row_den) * (LAT_MIN - LAT_MAX);
        for ci in 0..cols {
            let lon = LON_MIN + (ci as f64 / col_den) * (LON_MAX - LON_MIN);
            points.push(GridPoint { lat, lon });
        }
    }
    points
}

fn env_count(name: &str, default: usize) -> usize {
    match std::env::var(name) {
        Ok(text) => match text.parse::<f64>() {
            Ok(value) if value.is_finite() && value >= 4.0 => value as usize,
            _ => {
                if name.ends_with("ROWS") {
                    18
                } else {
                    27
                }
            }
        },
        Err(_) => default,
    }
}
