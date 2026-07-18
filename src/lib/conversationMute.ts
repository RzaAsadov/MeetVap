export type ConversationMuteDurationMinutes = 15 | 60 | 240 | 480 | 1440;

export const CONVERSATION_MUTE_OPTIONS: Array<{
  durationMinutes?: ConversationMuteDurationMinutes;
  labelKey: 'muteForever' | 'muteFor15Minutes' | 'muteFor1Hour' | 'muteFor4Hours' | 'muteFor8Hours' | 'muteFor24Hours';
}> = [
  { labelKey: 'muteForever' },
  { durationMinutes: 15, labelKey: 'muteFor15Minutes' },
  { durationMinutes: 60, labelKey: 'muteFor1Hour' },
  { durationMinutes: 240, labelKey: 'muteFor4Hours' },
  { durationMinutes: 480, labelKey: 'muteFor8Hours' },
  { durationMinutes: 1440, labelKey: 'muteFor24Hours' },
];

export function isConversationMuted(conversation?: { isMuted?: boolean; mutedUntil?: string | null } | null) {
  return conversation?.isMuted === true && (!conversation.mutedUntil || Date.parse(conversation.mutedUntil) > Date.now());
}
