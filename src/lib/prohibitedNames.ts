const MEETVAP_KEYWORD_PATTERN = /meetvap/i;

export function containsMeetVapKeyword(value: string) {
  return MEETVAP_KEYWORD_PATTERN.test(value);
}

export function isProhibitedMeetVapUsername(value: string) {
  return value.trim().toLowerCase() === 'meetvap';
}
