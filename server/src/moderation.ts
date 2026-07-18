export const OBJECTIONABLE_CONTENT_MESSAGE = 'This content is not allowed by MeetVap community rules';

const DEFAULT_OBJECTIONABLE_TERMS = [
  'bitch',
  'child porn',
  'child pornography',
  'fuck you',
  'kill yourself',
  'nigger',
  'rape you',
];

function normalize(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function getBlockedTerms() {
  const configuredTerms = (process.env.OBJECTIONABLE_CONTENT_TERMS ?? '')
    .split(',')
    .map(normalize)
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_OBJECTIONABLE_TERMS.map(normalize), ...configuredTerms]));
}

export function containsObjectionableContent(value: string) {
  const normalizedValue = normalize(value);

  return normalizedValue !== '' && getBlockedTerms().some((term) => (
    ` ${normalizedValue} `.includes(` ${term} `)
  ));
}
