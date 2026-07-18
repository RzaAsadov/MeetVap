const MOBILE_CALL_ANSWER_CLIENT_ID = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function getMobileCallAnswerClientId() {
  return MOBILE_CALL_ANSWER_CLIENT_ID;
}
