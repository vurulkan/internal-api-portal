import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { z } from 'zod';
import { readPref, writePref } from '@/lib/storage';
import { en } from './en';
import { tr } from './tr';

// zod's fast path compiles validators with new Function, which the CSP (script-src
// 'self', no 'unsafe-eval') refuses and reports; the interpreted path is enough here.
z.config({ jitless: true });

export const SUPPORTED_LOCALES = ['en', 'tr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const STORAGE_KEY = 'portal.locale';

function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The saved choice, else the browser language, else English. */
export function initialLocale(): Locale {
  const stored = readPref(STORAGE_KEY);
  if (isLocale(stored)) return stored;
  const browser = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : '';
  return isLocale(browser) ? browser : 'en';
}

export function setLocale(locale: Locale) {
  writePref(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr } },
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

function syncDocumentLanguage(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
