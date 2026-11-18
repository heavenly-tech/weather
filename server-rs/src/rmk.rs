//! `VIS EST` and `CLD EST` are allowed only after the trailing `RMK`.

use crate::metar::STAMP;

pub fn assert_est_only_in_trailing_rmk(raw: &str) -> Result<(), String> {
    let prefix = format!("{STAMP}\n");
    let without_stamp = raw.strip_prefix(&prefix).unwrap_or(raw);
    let before_rmk = match without_stamp.find(" RMK ") {
        Some(index) => &without_stamp[..index],
        None => without_stamp,
    };
    if has_est_token(before_rmk) {
        let end = before_rmk.chars().take(120).collect::<String>();
        return Err(format!("EST token must not appear before RMK: {end}…"));
    }
    Ok(())
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn has_est_token(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let boundary = index == 0 || !is_word(bytes[index - 1]);
        if boundary {
            for token in ["VIS", "CLD"] {
                let token_bytes = token.as_bytes();
                let after = index + token_bytes.len();
                if bytes[index..].starts_with(token_bytes)
                    && (after == bytes.len() || !is_word(bytes[after]))
                    && est_follows(bytes, after)
                {
                    return true;
                }
            }
        }
        index += 1;
    }
    false
}

fn est_follows(bytes: &[u8], mut index: usize) -> bool {
    if index >= bytes.len() || !bytes[index].is_ascii_whitespace() {
        return false;
    }
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    let after = index + 3;
    bytes[index..].starts_with(b"EST") && (after == bytes.len() || !is_word(bytes[after]))
}
