//! Unread mail from the mail app's Dock badge. `lsappinfo` reads it without
//! any permission prompt, unlike asking Mail over AppleScript.

use std::process::Command;

/// Mail apps whose Dock badge counts unread mail, in the order asked.
const MAIL_APPS: [&str; 2] = ["Mail", "Microsoft Outlook"];

/// `None` when no mail app runs; a running app without a badge has 0 unread.
pub fn unread() -> Option<u32> {
    MAIL_APPS.iter().find_map(|app| {
        let out = Command::new("lsappinfo")
            .args(["info", "-only", "StatusLabel", app])
            .output()
            .ok()?;
        parse_badge(&String::from_utf8_lossy(&out.stdout))
    })
}

/// `"StatusLabel"={ "label"="3" }` → 3, `"StatusLabel"=[ NULL ]` → 0, nothing (not running) → None.
fn parse_badge(out: &str) -> Option<u32> {
    if !out.contains("StatusLabel") {
        return None;
    }
    let digits: String = out
        .split("\"label\"=\"")
        .nth(1)
        .unwrap_or("")
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    Some(digits.parse().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::parse_badge;

    #[test]
    fn reads_the_badge() {
        assert_eq!(
            parse_badge("\"StatusLabel\"={ \"label\"=\"12\" }\n"),
            Some(12)
        );
        assert_eq!(parse_badge("\"StatusLabel\"=[ NULL ] \n"), Some(0));
        assert_eq!(parse_badge(""), None);
    }
}
