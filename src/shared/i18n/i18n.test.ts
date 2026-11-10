import { de } from "./de";
import { en, type MessageKey } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { vi } from "./vi";
import { zh } from "./zh";
import { resolveLanguage, setLanguage, t } from ".";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

it("keeps every value placeholder in every language", () => {
  for (const [name, messages] of Object.entries({ zh, vi, ja, ko, es, fr, de })) {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect([name, key, placeholders(messages[key])]).toEqual([name, key, placeholders(en[key])]);
    }
  }
});

it("picks the system language when it has one, else English", () => {
  expect(resolveLanguage("system", ["vi-VN", "en-US"])).toBe("vi");
  expect(resolveLanguage("system", ["zh-Hant-TW"])).toBe("zh");
  expect(resolveLanguage("system", ["th-TH", "de-AT"])).toBe("de");
  expect(resolveLanguage("system", ["th-TH"])).toBe("en");
  expect(resolveLanguage("ja", ["vi-VN"])).toBe("ja");
  expect(resolveLanguage("klingon", ["fr-CA"])).toBe("fr");
});

it("fills in values and switches language", () => {
  setLanguage("vi");
  expect(t("notif.seconds", { n: 5 })).toBe("5 giây");
  setLanguage("en");
  expect(t("notif.seconds", { n: 5 })).toBe("5 seconds");
});
