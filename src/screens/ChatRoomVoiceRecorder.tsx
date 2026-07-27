import { Ionicons } from '@expo/vector-icons';
import { RecordingPresets,requestRecordingPermissionsAsync,setAudioModeAsync,useAudioRecorder,useAudioRecorderState } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { Alert,PanResponder,Pressable,View } from 'react-native';

import { t } from '../i18n';
import { getActiveCallSession } from '../lib/activeCallSession';
import { beginAppLockForegroundOperation } from '../lib/appLockAccess';
import { colors } from '../theme/colors';
import { Message } from '../types/domain';
import { chatRoomStyles as styles } from './chat/ChatRoomStyles';
import {
getRecorderStatusSafely,
getRecordingDurationSeconds,
isReleasedRecorderError,
stopRecorderIfNeeded
} from './lib/ChatMediaHelpers';


export type VoiceRecordingComposerState = {
  durationMillis: number;
  isLocked: boolean;
  isPaused: boolean;
  isRecording: boolean;
};

const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  bitRate: 64000,
  numberOfChannels: 1,
  sampleRate: 44100,
  android: {
    audioEncoder: 'aac' as const,
    extension: '.m4a',
    outputFormat: 'mpeg4' as const,
  },
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: '.m4a',
  },
};
const MIN_VOICE_RECORDING_SECONDS = 0.7;
const VOICE_RECORDING_HOLD_THRESHOLD_MS = 260;
const VOICE_RECORDING_LOCK_DRAG_Y = 54;

type HoldVoiceRecorderButtonProps = {
  onOpenVoiceEffectPicker: () => void;
  onRecorded: (message: Omit<Message, 'id' | 'conversationId' | 'createdAt' | 'senderId' | 'status'>, shouldSendNow?: boolean) => void;
  onSessionClosed: () => void;
  onStateChange: (state: VoiceRecordingComposerState) => void;
};

export function HoldVoiceRecorderButton({ onOpenVoiceEffectPicker, onRecorded, onSessionClosed, onStateChange }: HoldVoiceRecorderButtonProps) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  const [renderState, setRenderState] = useState({
    isLocked: false,
    isPaused: false,
    isRecording: false,
  });
  const [isTouchActive, setTouchActive] = useState(false);
  const isPreparingRef = useRef(false);
  const isHoldingRef = useRef(false);
  const isLockedRef = useRef(false);
  const isPausedRef = useRef(false);
  const isMountedRef = useRef(true);
  const shouldStopAfterPrepareRef = useRef(false);
  const shouldLockAfterStartRef = useRef(false);
  const startPressYRef = useRef<number | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const endLockDeferralRef = useRef<(() => void) | null>(null);

  const emitState = useCallback((patch?: Partial<VoiceRecordingComposerState>) => {
    const nextState = {
      durationMillis: recorderState.durationMillis,
      isLocked: isLockedRef.current,
      isPaused: isPausedRef.current,
      isRecording: recorderState.isRecording || isPreparingRef.current || isLockedRef.current,
      ...patch,
    };

    setRenderState((current) => (
      current.isLocked === nextState.isLocked
        && current.isPaused === nextState.isPaused
        && current.isRecording === nextState.isRecording
        ? current
        : {
            isLocked: nextState.isLocked,
            isPaused: nextState.isPaused,
            isRecording: nextState.isRecording,
          }
    ));
    onStateChange(nextState);
  }, [onStateChange, recorderState.durationMillis, recorderState.isRecording]);

  useEffect(() => {
    emitState();
  }, [emitState]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      isHoldingRef.current = false;
      isLockedRef.current = false;
      isPausedRef.current = false;
      shouldStopAfterPrepareRef.current = false;
      shouldLockAfterStartRef.current = false;
      endRecordingLockDeferral();
      clearStartTimer();
      setTouchActive(false);
      setRenderState({ isLocked: false, isPaused: false, isRecording: false });
      onStateChange({ durationMillis: 0, isLocked: false, isPaused: false, isRecording: false });
      void stopRecorderIfNeeded(recorder);
    };
  }, [onStateChange, recorder]);

  function isVoiceRecordingBlockedByActiveCall() {
    return getActiveCallSession()?.callState === 'active';
  }

  function showVoiceRecordingBlockedByActiveCall() {
    Alert.alert(t('voiceRecordingUnavailableDuringCallTitle'), t('voiceRecordingUnavailableDuringCallMessage'));
  }

  function scheduleHoldingRecording(pageY: number) {
    if (isHoldingRef.current || isPreparingRef.current || recorderState.isRecording || isLockedRef.current) {
      return;
    }

    if (isVoiceRecordingBlockedByActiveCall()) {
      showVoiceRecordingBlockedByActiveCall();
      return;
    }

    startPressYRef.current = pageY;
    clearStartTimer();
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      void startHoldingRecording();
    }, VOICE_RECORDING_HOLD_THRESHOLD_MS);
  }

  async function startHoldingRecording() {
    if (isVoiceRecordingBlockedByActiveCall()) {
      resetHoldingState();
      showVoiceRecordingBlockedByActiveCall();
      return;
    }

    const status = getRecorderStatusSafely(recorder);

    if (!isMountedRef.current || !status || isHoldingRef.current || isPreparingRef.current || status.isRecording) {
      return;
    }

    beginRecordingLockDeferral();
    isHoldingRef.current = true;
    isPausedRef.current = false;
    shouldStopAfterPrepareRef.current = false;
    isPreparingRef.current = true;
    startedAtRef.current = null;
    emitState({ durationMillis: 0, isPaused: false, isRecording: true });

    try {
      const permission = await requestRecordingPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('allowMicrophoneToRecordVoice'));
        resetHoldingState();
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      if (!isMountedRef.current) {
        resetHoldingState();
        return;
      }

      const preparedStatus = getRecorderStatusSafely(recorder);

      if (!preparedStatus) {
        resetHoldingState();
        await restorePlaybackAudioMode();
        return;
      }

      if (!preparedStatus.canRecord) {
        await recorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
      }

      if (!isMountedRef.current || !isHoldingRef.current || shouldStopAfterPrepareRef.current) {
        isPreparingRef.current = false;
        await stopHoldingRecording(false);
        return;
      }

      isPreparingRef.current = false;
      recorder.record();
      startedAtRef.current = Date.now();
      if (shouldLockAfterStartRef.current) {
        isLockedRef.current = true;
        isHoldingRef.current = false;
      }
      emitState({ isLocked: isLockedRef.current, isRecording: true });
    } catch (error) {
      if (!isReleasedRecorderError(error)) {
        Alert.alert(t('recordingFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      }
      resetHoldingState();
      await stopRecorderIfNeeded(recorder);
      await restorePlaybackAudioMode();
    } finally {
      isPreparingRef.current = false;
    }
  }

  function handlePressMove(pageY: number) {
    if (isLockedRef.current) {
      return;
    }

    const startY = startPressYRef.current;

    if (startY === null || startY - pageY < VOICE_RECORDING_LOCK_DRAG_Y) {
      return;
    }

    if (!isHoldingRef.current && !isPreparingRef.current && !recorderState.isRecording) {
      shouldLockAfterStartRef.current = true;
      return;
    }

    isLockedRef.current = true;
    isHoldingRef.current = false;
    shouldLockAfterStartRef.current = false;
    emitState({ isLocked: true, isRecording: true });
  }

  async function releaseHoldingRecording() {
    if (startTimerRef.current) {
      clearStartTimer();
      startPressYRef.current = null;
      shouldLockAfterStartRef.current = false;
      return;
    }

    if (isLockedRef.current) {
      return;
    }

    await stopHoldingRecording(false);
  }

  async function stopHoldingRecording(shouldSendNow: boolean) {
    const status = getRecorderStatusSafely(recorder);

    if (!isMountedRef.current || (!isHoldingRef.current && !isLockedRef.current && !isPreparingRef.current && !status?.isRecording && !status?.canRecord)) {
      return;
    }

    isHoldingRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;

    if (isPreparingRef.current) {
      shouldStopAfterPrepareRef.current = true;
      return;
    }

    try {
      const durationSeconds = getRecordingDurationSeconds(recorderState.durationMillis, startedAtRef.current);

      await stopRecorderIfNeeded(recorder);
      await restorePlaybackAudioMode();

      const uri = recorder.uri ?? recorderState.url;

      if (!uri || durationSeconds < MIN_VOICE_RECORDING_SECONDS) {
        resetHoldingState();
        return;
      }

      onRecorded({
        body: t('voiceMessage'),
        durationSeconds,
        fileName: 'voice-message.m4a',
        kind: 'voice',
        mediaUri: uri,
        mimeType: 'audio/mp4',
      }, shouldSendNow);
      onSessionClosed();
    } catch (error) {
      if (!isReleasedRecorderError(error)) {
        Alert.alert(t('recordingFailed'), t('pleaseTryAgain'));
      }
    } finally {
      resetHoldingState();
    }
  }

  function clearStartTimer() {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }

  function beginRecordingLockDeferral() {
    if (!endLockDeferralRef.current) {
      endLockDeferralRef.current = beginAppLockForegroundOperation();
    }
  }

  function endRecordingLockDeferral() {
    const endLockDeferral = endLockDeferralRef.current;

    if (!endLockDeferral) {
      return;
    }

    endLockDeferralRef.current = null;
    endLockDeferral();
  }

  function togglePause() {
    const status = getRecorderStatusSafely(recorder);

    if (!status?.canRecord) {
      return;
    }

    try {
      if (isPausedRef.current) {
        recorder.record();
        isPausedRef.current = false;
      } else if (status.isRecording) {
        recorder.pause();
        isPausedRef.current = true;
      }
      emitState({ isPaused: isPausedRef.current, isRecording: true });
    } catch (error) {
      if (!isReleasedRecorderError(error)) {
        Alert.alert(t('recordingFailed'), t('pleaseTryAgain'));
      }
    }
  }

  async function discardLockedRecording() {
    isHoldingRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;
    shouldLockAfterStartRef.current = false;
    clearStartTimer();

    const uri = recorder.uri ?? recorderState.url;
    await stopRecorderIfNeeded(recorder);
    await restorePlaybackAudioMode();
    if (uri) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
    resetHoldingState();
    onSessionClosed();
  }

  function resetHoldingState() {
    isHoldingRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;
    shouldStopAfterPrepareRef.current = false;
    shouldLockAfterStartRef.current = false;
    isPreparingRef.current = false;
    startedAtRef.current = null;
    startPressYRef.current = null;
    clearStartTimer();
    endRecordingLockDeferral();
    setTouchActive(false);
    setRenderState({ isLocked: false, isPaused: false, isRecording: false });
    onStateChange({ durationMillis: 0, isLocked: false, isPaused: false, isRecording: false });
  }

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dy) > 2 || Math.abs(gestureState.dx) > 2 || isHoldingRef.current || isPreparingRef.current || renderState.isRecording
    ),
    onPanResponderGrant: (event) => {
      setTouchActive(true);
      scheduleHoldingRecording(event.nativeEvent.pageY);
    },
    onPanResponderMove: (event) => {
      handlePressMove(event.nativeEvent.pageY);
    },
    onPanResponderRelease: () => {
      setTouchActive(false);
      void releaseHoldingRecording();
    },
    onPanResponderTerminate: () => {
      setTouchActive(false);
      void releaseHoldingRecording();
    },
    onPanResponderTerminationRequest: () => false,
    onStartShouldSetPanResponder: () => true,
  }), [renderState.isRecording]);

  if (renderState.isLocked && !isTouchActive) {
    return (
      <View style={styles.lockedVoiceActions}>
        <Pressable onPress={() => void discardLockedRecording()} style={[styles.lockedVoiceButton, styles.lockedVoiceDeleteButton]}>
          <Ionicons color={colors.danger} name="trash-outline" size={20} />
        </Pressable>
        <Pressable onPress={togglePause} style={styles.lockedVoiceButton}>
          <Ionicons color={renderState.isPaused ? colors.danger : colors.textPrimary} name={renderState.isPaused ? 'mic' : 'pause'} size={20} />
        </Pressable>
        <Pressable onPress={onOpenVoiceEffectPicker} style={styles.lockedVoiceButton}>
          <Ionicons color={colors.textSecondary} name="settings-outline" size={20} />
        </Pressable>
        <Pressable onPress={() => void stopHoldingRecording(true)} style={styles.sendButton}>
          <Ionicons color={colors.white} name="send" size={20} />
        </Pressable>
      </View>
    );
  }

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.sendButton, renderState.isRecording && styles.recordingButton, isTouchActive && styles.micButtonPressed]}
    >
      <Ionicons color={colors.white} name={renderState.isRecording ? 'radio-button-on' : 'mic'} size={20} />
    </View>
  );
}

export async function restorePlaybackAudioMode() {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
  });
}
