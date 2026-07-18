export type DisappearingMessagesDurationMinutes = 240 | 480 | 1440 | 10080;

export const DISAPPEARING_MESSAGES_OPTIONS: Array<{
  durationMinutes: DisappearingMessagesDurationMinutes;
  labelKey: 'duration4Hours' | 'duration8Hours' | 'duration24Hours' | 'duration1Week';
}> = [
  { durationMinutes: 240, labelKey: 'duration4Hours' },
  { durationMinutes: 480, labelKey: 'duration8Hours' },
  { durationMinutes: 1440, labelKey: 'duration24Hours' },
  { durationMinutes: 10080, labelKey: 'duration1Week' },
];

export function getDisappearingMessagesDurationLabelKey(durationMinutes?: number | null) {
  return DISAPPEARING_MESSAGES_OPTIONS.find((option) => option.durationMinutes === durationMinutes)?.labelKey;
}
