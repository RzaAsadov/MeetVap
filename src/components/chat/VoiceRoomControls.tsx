import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, Text } from 'react-native';

import type { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

type VoiceRoomControlsProps = {
  adminMuted: boolean;
  connectedLabel: string;
  connectingLabel: string;
  isConnected: boolean;
  isConnecting: boolean;
  isPushToTalking: boolean;
  isSelfMuted: boolean;
  isSpeakerMuted: boolean;
  onBeginPushToTalk: () => void;
  onEndPushToTalk: () => void;
  onOpenPeople: () => void;
  onOpenRoutePicker: () => void;
  onToggleMic: () => void;
  onToggleSpeakerMute: () => void;
  participantCount: number;
  themeColors: ThemeColors;
};

export const VoiceRoomControls = memo(function VoiceRoomControls({
  adminMuted,
  connectedLabel,
  connectingLabel,
  isConnected,
  isConnecting,
  isPushToTalking,
  isSelfMuted,
  isSpeakerMuted,
  onBeginPushToTalk,
  onEndPushToTalk,
  onOpenPeople,
  onOpenRoutePicker,
  onToggleMic,
  onToggleSpeakerMute,
  participantCount,
  themeColors,
}: VoiceRoomControlsProps) {
  const isMicDisabled = !isConnected || adminMuted;
  const isPushToTalkDisabled = !isConnected || !isSelfMuted || adminMuted;

  return (
    <View style={[styles.controls, { backgroundColor: themeColors.chatBackground, borderTopColor: themeColors.border }]}>
      <Pressable
        disabled={isMicDisabled}
        onPress={onToggleMic}
        style={[
          styles.controlButton,
          { backgroundColor: isSelfMuted ? themeColors.danger : themeColors.primary },
          isMicDisabled && styles.controlButtonDisabled,
        ]}
      >
        <Ionicons color={themeColors.white} name={isSelfMuted ? 'mic-off' : 'mic'} size={19} />
      </Pressable>
      <Pressable
        disabled={!isConnected}
        onLongPress={onOpenRoutePicker}
        onPress={onToggleSpeakerMute}
        style={[
          styles.controlButton,
          { backgroundColor: isSpeakerMuted ? themeColors.danger : themeColors.primary },
          !isConnected && styles.controlButtonDisabled,
        ]}
      >
        <Ionicons color={themeColors.white} name={isSpeakerMuted ? 'volume-mute' : 'volume-high'} size={19} />
      </Pressable>
      <Pressable
        disabled={isPushToTalkDisabled}
        onPressIn={onBeginPushToTalk}
        onPressOut={onEndPushToTalk}
        style={[
          styles.pushToTalkButton,
          {
            backgroundColor: isPushToTalking ? themeColors.primary : themeColors.surface,
            borderColor: isSelfMuted ? themeColors.primary : themeColors.border,
          },
          isPushToTalkDisabled && styles.controlButtonDisabled,
        ]}
      >
        <Ionicons color={isPushToTalking ? themeColors.white : themeColors.textPrimary} name="mic" size={26} />
      </Pressable>
      <Pressable
        onPress={onOpenPeople}
        style={[styles.peopleButton, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
      >
        <Ionicons color={themeColors.white} name="people" size={19} />
        <Text style={[styles.peopleText, { color: themeColors.textPrimary }]}>{participantCount}</Text>
      </Pressable>
      <View style={styles.status}>
        {isConnecting ? <ActivityIndicator color={themeColors.primary} size="small" /> : null}
        {!isConnecting ? (
          <View
            accessibilityLabel={isConnected && !adminMuted ? connectedLabel : connectingLabel}
            style={[
              styles.statusLight,
              { backgroundColor: isConnected && !adminMuted ? '#22c55e' : themeColors.danger },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  controlButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  controlButtonDisabled: {
    opacity: 0.45,
  },
  controls: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  peopleButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  peopleText: {
    fontSize: 13,
    fontWeight: '900',
  },
  pushToTalkButton: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    marginLeft: 'auto',
    width: 48,
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minWidth: 18,
  },
  statusLight: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
});
