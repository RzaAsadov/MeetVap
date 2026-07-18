import * as Localization from 'expo-localization';

import { az } from './az';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { pt } from './pt';
import { ptBR } from './ptBR';
import { ru } from './ru';
import { tr } from './tr';
import { APP_LANGUAGES, LANGUAGE_PREFERENCES } from './types';
import type { AppLanguage, LanguagePreference, TranslationValue } from './types';

export { APP_LANGUAGES, LANGUAGE_PREFERENCES } from './types';
export type { AppLanguage, LanguagePreference, TranslationValue } from './types';

const translations: Record<AppLanguage, Record<string, TranslationValue>> = {
  az,
  de,
  en,
  es,
  fr,
  it,
  pt,
  'pt-BR': ptBR,
  ru,
  tr,
};

const languageMetadata: Record<LanguagePreference, { flag: string; label: string }> = {
  az: { flag: '🇦🇿', label: 'Azərbaycanca' },
  de: { flag: '🇩🇪', label: 'Deutsch' },
  en: { flag: '🇬🇧', label: 'English' },
  es: { flag: '🇪🇸', label: 'Español' },
  fr: { flag: '🇫🇷', label: 'Français' },
  it: { flag: '🇮🇹', label: 'Italiano' },
  pt: { flag: '🇵🇹', label: 'Português' },
  'pt-BR': { flag: '🇧🇷', label: 'Português (Brasil)' },
  ru: { flag: '🇷🇺', label: 'Русский' },
  system: { flag: '🌐', label: '' },
  tr: { flag: '🇹🇷', label: 'Türkçe' },
};

let currentLanguage: AppLanguage = getDeviceLanguage();

export function getDeviceLanguage(): AppLanguage {
  const locale = Localization.getLocales()[0];
  const languageCode = locale?.languageCode?.toLowerCase();
  const languageTag = locale?.languageTag?.toLowerCase();

  if (languageTag === 'pt-br') {
    return 'pt-BR';
  }

  return APP_LANGUAGES.find((language) => language.toLowerCase() === languageCode) ?? 'en';
}

export function isLanguagePreference(value: string | null | undefined): value is LanguagePreference {
  return LANGUAGE_PREFERENCES.includes(value as LanguagePreference);
}

export function resolveLanguage(preference: LanguagePreference): AppLanguage {
  return preference === 'system' ? getDeviceLanguage() : preference;
}

export function setI18nLanguage(language: AppLanguage) {
  currentLanguage = language;
}

export function getI18nLanguage() {
  return currentLanguage;
}

export function getLanguagePreferenceLabel(preference: LanguagePreference) {
  return preference === 'system' ? translate('languageSystem') : languageMetadata[preference].label;
}

export function getLanguagePreferenceFlag(preference: LanguagePreference) {
  return languageMetadata[preference].flag;
}

export function translate(key: string, params: Record<string, string | number> = {}, language = currentLanguage) {
  const value = translations[language][key] ?? translations.en[key] ?? key;

  return typeof value === 'function' ? value(params) : value;
}

export const t = translate;
