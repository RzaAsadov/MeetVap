export const MEETVAP_VOICE_ROOM_DEBUG = false;

const TAG = '[MeetVapVoiceRoom]';

export function logVoiceRoomDiagnostic(event: string, details?: Record<string, unknown>) {
  if (!MEETVAP_VOICE_ROOM_DEBUG) {
    return;
  }

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...(details ?? {}),
  };

  try {
    console.log(TAG, JSON.stringify(payload));
  } catch {
    console.log(TAG, event);
  }
}
