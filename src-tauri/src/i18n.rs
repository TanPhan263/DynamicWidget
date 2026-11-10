//! The few texts the core writes itself: the tray menu and system
//! notifications. The pages hold everything else and tell the core which
//! language they show (`set_ui_language`). `{pct}` and `{name}` are filled in
//! by the caller.

use crate::core::settings_service::LANGUAGES;

#[derive(Clone, Copy, Debug)]
pub enum Text {
    OpenIsland,
    DoNotDisturb,
    HideIsland,
    SendTest,
    ApiOff,
    ApiPortUnavailable,
    Settings,
    Quit,
    TooltipDnd,
    TestTitle,
    TestBody,
    // The in-app screen recorder is macOS-only.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    RecordingSaved,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Desktop,
    Charging,
    PowerConnected,
    OnBattery,
    Remaining,
    FullyCharged,
    Unplug,
    BatteryAt,
    ChargeSoon,
}

const COUNT: usize = Text::ChargeSoon as usize + 1;
type Table = [&'static str; COUNT];

const EN: Table = [
    "Open Island",
    "Do Not Disturb",
    "Hide Island",
    "Send Test Notification",
    "API: Off",
    "API: Port Unavailable",
    "Settings…",
    "Quit Islet",
    "Islet: Do Not Disturb",
    "Hello from Islet",
    "Notifications from scripts, timers and your battery appear here.",
    "Screen recording saved",
    "Desktop",
    "Charging",
    "{pct}% · power connected",
    "On battery",
    "{pct}% remaining",
    "Fully charged",
    "You can unplug the charger",
    "Battery at {pct}%",
    "Connect a charger soon",
];

const ZH: Table = [
    "打开灵动岛",
    "勿扰模式",
    "隐藏灵动岛",
    "发送测试通知",
    "API：已关闭",
    "API：端口不可用",
    "设置…",
    "退出 Islet",
    "Islet：勿扰模式",
    "来自 Islet 的问候",
    "来自脚本、计时器和电池的通知会显示在这里。",
    "屏幕录制已保存",
    "桌面",
    "正在充电",
    "{pct}% · 已接通电源",
    "正在使用电池",
    "剩余 {pct}%",
    "已充满",
    "可以拔下充电器了",
    "电量 {pct}%",
    "请尽快连接充电器",
];

const VI: Table = [
    "Mở Island",
    "Không làm phiền",
    "Ẩn Island",
    "Gửi thông báo thử",
    "API: Tắt",
    "API: Cổng không khả dụng",
    "Cài đặt…",
    "Thoát Islet",
    "Islet: Không làm phiền",
    "Xin chào từ Islet",
    "Thông báo từ script, hẹn giờ và pin sẽ hiển thị tại đây.",
    "Đã lưu bản ghi màn hình",
    "Màn hình nền",
    "Đang sạc",
    "{pct}% · đã cắm nguồn",
    "Đang dùng pin",
    "Còn {pct}%",
    "Đã sạc đầy",
    "Bạn có thể rút bộ sạc",
    "Pin còn {pct}%",
    "Hãy sớm cắm bộ sạc",
];

const JA: Table = [
    "アイランドを開く",
    "おやすみモード",
    "アイランドを隠す",
    "テスト通知を送信",
    "API：オフ",
    "API：ポートを使用できません",
    "設定…",
    "Islet を終了",
    "Islet：おやすみモード",
    "Islet からこんにちは",
    "スクリプト、タイマー、バッテリーからの通知がここに表示されます。",
    "画面収録を保存しました",
    "デスクトップ",
    "充電中",
    "{pct}% · 電源に接続中",
    "バッテリー駆動",
    "残り {pct}%",
    "充電完了",
    "充電器を外しても大丈夫です",
    "バッテリー残量 {pct}%",
    "早めに充電器を接続してください",
];

const KO: Table = [
    "아일랜드 열기",
    "방해 금지 모드",
    "아일랜드 숨기기",
    "테스트 알림 보내기",
    "API: 꺼짐",
    "API: 포트를 사용할 수 없음",
    "설정…",
    "Islet 종료",
    "Islet: 방해 금지 모드",
    "Islet에서 보낸 인사",
    "스크립트, 타이머, 배터리의 알림이 여기에 표시됩니다.",
    "화면 기록이 저장됨",
    "데스크탑",
    "충전 중",
    "{pct}% · 전원 연결됨",
    "배터리 사용 중",
    "{pct}% 남음",
    "충전 완료",
    "충전기를 분리해도 됩니다",
    "배터리 {pct}%",
    "곧 충전기를 연결하세요",
];

const ES: Table = [
    "Abrir isla",
    "No molestar",
    "Ocultar isla",
    "Enviar notificación de prueba",
    "API: desactivada",
    "API: puerto no disponible",
    "Ajustes…",
    "Salir de Islet",
    "Islet: No molestar",
    "Hola desde Islet",
    "Aquí aparecen las notificaciones de scripts, temporizadores y la batería.",
    "Grabación de pantalla guardada",
    "Escritorio",
    "En carga",
    "{pct}% · conectado a la corriente",
    "Con batería",
    "{pct}% restante",
    "Carga completa",
    "Ya puedes desconectar el cargador",
    "Batería al {pct}%",
    "Conecta un cargador pronto",
];

const FR: Table = [
    "Ouvrir l’île",
    "Ne pas déranger",
    "Masquer l’île",
    "Envoyer une notification de test",
    "API : désactivée",
    "API : port indisponible",
    "Réglages…",
    "Quitter Islet",
    "Islet : Ne pas déranger",
    "Bonjour de la part d’Islet",
    "Les notifications des scripts, des minuteurs et de la batterie s’affichent ici.",
    "Enregistrement de l’écran sauvegardé",
    "Bureau",
    "En charge",
    "{pct} % · secteur branché",
    "Sur batterie",
    "{pct} % restants",
    "Charge complète",
    "Vous pouvez débrancher le chargeur",
    "Batterie à {pct} %",
    "Branchez bientôt un chargeur",
];

const DE: Table = [
    "Insel öffnen",
    "Nicht stören",
    "Insel ausblenden",
    "Testmitteilung senden",
    "API: Aus",
    "API: Port nicht verfügbar",
    "Einstellungen …",
    "Islet beenden",
    "Islet: Nicht stören",
    "Hallo von Islet",
    "Mitteilungen von Skripten, Timern und dem Akku erscheinen hier.",
    "Bildschirmaufnahme gespeichert",
    "Schreibtisch",
    "Lädt",
    "{pct} % · Netzteil angeschlossen",
    "Akkubetrieb",
    "{pct} % verbleibend",
    "Vollständig geladen",
    "Du kannst das Ladegerät trennen",
    "Akku bei {pct} %",
    "Schließe bald ein Ladegerät an",
];

/// A supported language code as a static string, or English.
pub fn language(code: &str) -> &'static str {
    LANGUAGES
        .iter()
        .find(|&&l| l == code)
        .copied()
        .unwrap_or("en")
}

pub fn text(lang: &str, text: Text) -> &'static str {
    let table = match lang {
        "zh" => &ZH,
        "vi" => &VI,
        "ja" => &JA,
        "ko" => &KO,
        "es" => &ES,
        "fr" => &FR,
        "de" => &DE,
        _ => &EN,
    };
    table[text as usize]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_language_keeps_the_placeholders() {
        for lang in LANGUAGES {
            for t in [Text::PowerConnected, Text::Remaining, Text::BatteryAt] {
                assert!(text(lang, t).contains("{pct}"), "{lang} {t:?}");
            }
        }
    }

    #[test]
    fn unknown_languages_read_english() {
        assert_eq!(language("xx"), "en");
        assert_eq!(text("xx", Text::Quit), "Quit Islet");
        assert_eq!(text("vi", Text::Quit), "Thoát Islet");
    }
}
