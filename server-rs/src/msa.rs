//! 25 NM AIP minimum sector altitude, used as the Annex 3 NSC ceiling.
//!
//! NSC is blocked by BKN/OVC below `max(5000 ft, MSA AGL)`.

use crate::ceiling::M_TO_FT;

pub const ANNEX3_NSC_MIN_FT: f64 = 5000.0;

#[derive(Clone, Copy, Debug)]
pub struct AirfieldMsa {
    pub icao: &'static str,
    pub msa_ft_amsl: f64,
    pub assumption: bool,
    pub citation: &'static str,
}

const AIRFIELD_MSA: [AirfieldMsa; 5] = [
    AirfieldMsa {
        icao: "SCTB",
        msa_ft_amsl: 20_000.0,
        assumption: false,
        citation: "AIP Chile VOL II SCTB IAC 1 RNP RWY 01 (LNAV only): MSA 25 NM RW01 = 20000 ft. DGAC AMDT 100, effective 07 AUG 2025. https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/aipmap/SCTB/SCTB%20IAC1.pdf",
    },
    AirfieldMsa {
        icao: "SCEL",
        msa_ft_amsl: 19_000.0,
        assumption: false,
        citation: "AIP Chile VOL II SCEL IAC 2 ILS Z RWY 17R: MSA 25 NM AMB = 19000 ft. DGAC AMDT 103, effective 06 AUG 2026. Same figure on SCEL IAC 1. https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/aipmap/SCEL/SCEL%20IAC2.pdf",
    },
    AirfieldMsa {
        icao: "SCVM",
        msa_ft_amsl: 9_500.0,
        assumption: false,
        citation: "AIP Chile VOL II SCVM IAC 2 ILS Y o LOC Y RWY 05: MSA 25 NM SAL = 9500 ft. DGAC AMDT 98, effective 28 NOV 2024. Same figure on SCVM IAC 1. https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/aipmap/SCVM/SCVM%20IAC2.pdf",
    },
    AirfieldMsa {
        icao: "SCVH",
        msa_ft_amsl: 9_500.0,
        assumption: true,
        citation: "ASSUMPTION — no published MSA. AIP Chile AD 3 La Victoria de Chacabuco (SCVH) is VFR; VAC AMDT 62 effective 28 NOV 2024 has terrain and circuit altitudes only, and aipmap has no SCVH IAC. 9500 ft AMSL kept as a conservative sector (Andes east of the Chacabuco valley). https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/ais/3%20AD%20Parte%203/AD%203%20VAC/04%20VAC%20SCVH%20AD%20La%20Victoria%20de%20Chacabuco%20-%20Colina.pdf",
    },
    AirfieldMsa {
        icao: "SCPD",
        msa_ft_amsl: 9_500.0,
        assumption: true,
        citation: "ASSUMPTION — no published MSA. AIP Chile AD 3 Peldehue (SCPD) is VFR; VAC AMDT 67 effective 06 AUG 2026 has no MSA circle, and aipmap has no SCPD IAC. 9500 ft AMSL kept for the same pre-cordillera sector as SCVH. https://ftp2.dgac.gob.cl/dasa/aip_chile_con_contenido/ais/3%20AD%20Parte%203/AD%203%20VAC/05%20VAC%20SCPD%20AD%20Peldehue%20-%20Colina.pdf",
    },
];

pub fn airfield_msa(icao: &str) -> Option<&'static AirfieldMsa> {
    let icao = icao.to_ascii_uppercase();
    AIRFIELD_MSA.iter().find(|row| row.icao == icao)
}

/// Feet AGL below which BKN/OVC blocks NSC.
pub fn annex3_nsc_ceiling_ft_agl(icao: &str, elev_m: f64) -> f64 {
    let msa_amsl = airfield_msa(icao)
        .map(|row| row.msa_ft_amsl)
        .unwrap_or(ANNEX3_NSC_MIN_FT);
    let msa_agl = (msa_amsl - elev_m * M_TO_FT).max(0.0);
    ANNEX3_NSC_MIN_FT.max(msa_agl)
}
