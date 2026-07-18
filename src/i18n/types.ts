export const APP_LANGUAGES = ['en', 'tr', 'ru', 'de', 'es', 'it', 'az', 'fr', 'pt', 'pt-BR'] as const;
export type AppLanguage = typeof APP_LANGUAGES[number];

export const LANGUAGE_PREFERENCES = ['system', ...APP_LANGUAGES] as const;
export type LanguagePreference = typeof LANGUAGE_PREFERENCES[number];

export type TranslationValue = string | ((params: Record<string, string | number>) => string);
