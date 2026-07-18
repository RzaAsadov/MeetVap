const LOCALE_BY_LANGUAGE: Record<string, string> = {
  az: 'az-AZ',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  'pt-BR': 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
};

const YESTERDAY_BY_LANGUAGE: Record<string, string> = {
  az: 'Dünən',
  de: 'Gestern',
  en: 'Yesterday',
  es: 'Ayer',
  fr: 'Hier',
  it: 'Ieri',
  pt: 'Ontem',
  'pt-BR': 'Ontem',
  ru: 'Вчера',
  tr: 'Dün',
};

export function formatBytes(bytes?: number) {
  if (!bytes) {
    return 'Unknown size';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds?: number) {
  const safeSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(safeSeconds / 60).toString();
  const rest = (safeSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${rest}`;
}

export function formatConversationActivityTime(value?: string | null, language?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const locale = language ? LOCALE_BY_LANGUAGE[language] : undefined;
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (date >= startOfToday) {
    return time;
  }

  if (date >= startOfYesterday) {
    return language ? YESTERDAY_BY_LANGUAGE[language] ?? YESTERDAY_BY_LANGUAGE.en : YESTERDAY_BY_LANGUAGE.en;
  }

  if (date >= startOfWeek) {
    return date.toLocaleDateString(locale, { weekday: 'short' });
  }

  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });
}
