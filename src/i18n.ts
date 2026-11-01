import i18next from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    strictKeyChecks: true;
  }
}

void i18next
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en"],
    initAsync: false,
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });

export const t = i18next.t.bind(i18next);
export default i18next;
