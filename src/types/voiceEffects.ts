export type VoiceEffectId = 'normal' | 'deep' | 'bright' | 'helium';

export const DEFAULT_VOICE_EFFECT_ID: VoiceEffectId = 'normal';

const VOICE_EFFECT_IDS = new Set<VoiceEffectId>(['normal', 'deep', 'bright', 'helium']);

export function normalizeVoiceEffectId(effectId?: string | null): VoiceEffectId {
  return effectId && VOICE_EFFECT_IDS.has(effectId as VoiceEffectId)
    ? effectId as VoiceEffectId
    : DEFAULT_VOICE_EFFECT_ID;
}
