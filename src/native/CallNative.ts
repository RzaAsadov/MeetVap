import { NativeModules, Platform } from 'react-native';

import { t } from '../i18n';
import type { VoiceEffectId } from '../types/voiceEffects';

type CallNativeModule = {
  getAppVersion?: () => Promise<string | null>;
  attestAppAttestKey?: (keyId: string, challenge: string) => Promise<string | null>;
  generateAppAttestKey?: () => Promise<string | null>;
  processVoiceMessage?: (uri: string, effectId: string) => Promise<string>;
  requestPlayIntegrityToken?: (nonce: string) => Promise<string | null>;
  waitForCallKitAudioActivation?: () => Promise<boolean>;
  answerIncomingCallKitCall?: (callId: string) => Promise<boolean>;
  suppressIncomingCallKitCall?: (callId: string) => Promise<boolean>;
  peekPendingAnsweredCallKitCallId?: () => Promise<string | null>;
  peekPendingAnsweredCallKitUrl?: () => Promise<string | null>;
  consumePendingIncomingCallUrl?: () => Promise<string | null>;
  peekPendingIncomingCallUrl?: () => Promise<string | null>;
  canUseFullScreenIncomingCall?: () => Promise<boolean>;
  openFullScreenIncomingCallSettings?: () => void;
  consumeSharedItems?: () => Promise<NativeSharedItem[]>;
  hasPendingSharedItems?: () => Promise<boolean>;
  endCall?: (callId: string) => void;
  registerVoipPushToken?: () => Promise<string | null>;
  isMultitaskingCameraAccessSupported?: () => Promise<boolean>;
  enterPictureInPicture?: () => Promise<boolean>;
  closePictureInPicture?: () => Promise<boolean>;
  cancelMessageNotifications?: (conversationId?: string | null) => void;
  clearQuickReplyCredentials?: () => void;
  isPictureInPictureAvailable?: () => Promise<boolean>;
  setPictureInPictureEnabled?: (enabled: boolean) => void;
  setQuickReplyCredentials?: (serverUrl: string, authToken: string) => void;
  setMediaViewerOrientationUnlocked?: (unlocked: boolean) => void;
  setCallAudioRoute?: (speaker: boolean) => void;
  getCallAudioRoutes?: () => Promise<CallAudioRoute[]>;
  prepareCallAudioSession?: (mode: 'voice' | 'video', useSpeaker: boolean) => Promise<boolean>;
  prepareCallKitAudioSession?: (mode: 'voice' | 'video', useSpeaker: boolean) => Promise<boolean>;
  selectCallAudioRoute?: (routeId: string) => Promise<boolean>;
  clearCallAudioRoute?: () => void;
  beginLiveVoiceEffectSession?: (effectId: string) => void;
  getLiveVoiceEffect?: () => Promise<string | null>;
  getLiveVoiceEffectStatus?: () => Promise<LiveVoiceEffectStatus | null>;
  setLiveVoiceEffect?: (effectId: string) => void;
  setProximityScreenOffEnabled?: (enabled: boolean) => void;
  setScreenCaptureProtection?: (enabled: boolean) => void;
  startCallService?: (mode: 'voice' | 'video', sessionId?: string, voiceEffectId?: string) => void;
  stopCallService?: (sessionId?: string) => void;
  openFile?: (uri: string, mimeType?: string | null) => Promise<boolean>;
  saveFile?: (uri: string, mimeType?: string | null, displayName?: string | null) => Promise<boolean>;
  shareFile?: (uri: string, mimeType?: string | null, displayName?: string | null) => Promise<boolean>;
  renderImageDrawing?: (uri: string, strokesJson: string, outputFileName?: string | null) => Promise<RenderedImageDrawing>;
  cancelIncomingCall?: (callId?: string | null) => void;
  showIncomingCall?: (payload: AndroidIncomingCallPayload) => void;
  startIncomingRingtone?: () => void;
  stopIncomingRingtone?: () => void;
  startOutgoingRingback?: (uri: string, mode: 'voice' | 'video') => Promise<boolean>;
  stopOutgoingRingback?: () => void;
};

function getCallNativeModule() {
  return NativeModules.CallNative as CallNativeModule | undefined;
}

export type LiveVoiceEffectStatus = {
  attached?: boolean;
  effectId?: string | null;
  factoryInstalled?: boolean;
  lastProcessedEffectId?: string | null;
  processedBuffers?: number;
  processedFrames?: number;
  sampleScale?: string | null;
};

export type NativeSharedItem = {
  fileName?: string;
  kind: 'file' | 'text';
  mimeType?: string;
  sizeBytes?: number;
  text?: string;
  uri?: string;
};

export type AndroidIncomingCallPayload = {
  autoJoin?: boolean;
  callId: string;
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'VOICE' | 'VIDEO' | 'voice' | 'video';
  participantNames?: string[];
  title: string;
};

export type CallAudioRoute = {
  id: string;
  isActive: boolean;
  name: string;
  type: 'bluetooth' | 'earpiece' | 'speaker' | 'wired';
};

export type ImageDrawingPoint = {
  x: number;
  y: number;
};

export type ImageDrawingStroke = {
  color: string;
  points: ImageDrawingPoint[];
  width: number;
};

export type RenderedImageDrawing = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
};

export async function getNativeAppVersion() {
  return getCallNativeModule()?.getAppVersion?.().catch(() => null) ?? null;
}

export async function requestNativePlayIntegrityToken(nonce: string) {
  if (Platform.OS !== 'android') {
    return null;
  }

  return getCallNativeModule()?.requestPlayIntegrityToken?.(nonce).catch(() => null) ?? null;
}

export async function generateNativeAppAttestKey() {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return getCallNativeModule()?.generateAppAttestKey?.().catch(() => null) ?? null;
}

export async function attestNativeAppAttestKey(keyId: string, challenge: string) {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return getCallNativeModule()?.attestAppAttestKey?.(keyId, challenge).catch(() => null) ?? null;
}

export function setNativeQuickReplyCredentials(serverUrl: string, authToken: string) {
  getCallNativeModule()?.setQuickReplyCredentials?.(serverUrl, authToken);
}

export function clearNativeQuickReplyCredentials() {
  getCallNativeModule()?.clearQuickReplyCredentials?.();
}

export async function waitForNativeCallKitAudioActivation() {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.waitForCallKitAudioActivation?.().catch(() => false) ?? false;
}

export async function answerNativeIncomingCallKitCall(callId: string) {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.answerIncomingCallKitCall?.(callId).catch(() => false) ?? false;
}

export async function suppressNativeIncomingCallKitCall(callId: string) {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.suppressIncomingCallKitCall?.(callId).catch(() => false) ?? false;
}

export async function peekNativePendingAnsweredCallKitCallId() {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return getCallNativeModule()?.peekPendingAnsweredCallKitCallId?.().catch(() => null) ?? null;
}

export async function peekNativePendingAnsweredCallKitUrl() {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return getCallNativeModule()?.peekPendingAnsweredCallKitUrl?.().catch(() => null) ?? null;
}

export async function consumeNativePendingIncomingCallUrl() {
  return getCallNativeModule()?.consumePendingIncomingCallUrl?.().catch(() => null) ?? null;
}

export async function peekNativePendingIncomingCallUrl() {
  return getCallNativeModule()?.peekPendingIncomingCallUrl?.().catch(() => null) ?? null;
}

export async function canUseNativeFullScreenIncomingCalls() {
  if (Platform.OS !== 'android') {
    return true;
  }

  return getCallNativeModule()?.canUseFullScreenIncomingCall?.().catch(() => true) ?? true;
}

export function openNativeFullScreenIncomingCallSettings() {
  if (Platform.OS !== 'android') {
    return;
  }

  getCallNativeModule()?.openFullScreenIncomingCallSettings?.();
}

export async function prepareNativeCallAudioSession(mode: 'voice' | 'video', useSpeaker: boolean) {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.prepareCallAudioSession?.(mode, useSpeaker).catch(() => false) ?? false;
}

export async function prepareNativeCallKitAudioSession(mode: 'voice' | 'video', useSpeaker: boolean) {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.prepareCallKitAudioSession?.(mode, useSpeaker).catch(() => false) ?? false;
}

export async function consumeNativeSharedItems() {
  return getCallNativeModule()?.consumeSharedItems?.().catch(() => []) ?? [];
}

export async function isIosMultitaskingCameraAccessSupported() {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.isMultitaskingCameraAccessSupported?.().catch(() => false) ?? false;
}

export async function hasPendingNativeSharedItems() {
  return getCallNativeModule()?.hasPendingSharedItems?.().catch(() => false) ?? false;
}

export async function processNativeVoiceMessage(uri: string, effectId: string) {
  if (!effectId || effectId === 'normal') {
    return uri;
  }

  return getCallNativeModule()?.processVoiceMessage?.(uri, effectId).catch(() => uri) ?? uri;
}

export function setNativeLiveVoiceEffect(effectId: VoiceEffectId) {
  getCallNativeModule()?.setLiveVoiceEffect?.(effectId);
}

export async function getNativeLiveVoiceEffect() {
  return getCallNativeModule()?.getLiveVoiceEffect?.().catch(() => null) ?? null;
}

export async function getNativeLiveVoiceEffectStatus() {
  return getCallNativeModule()?.getLiveVoiceEffectStatus?.().catch(() => null) ?? null;
}

export function beginNativeLiveVoiceEffectSession(effectId: VoiceEffectId) {
  getCallNativeModule()?.beginLiveVoiceEffectSession?.(effectId);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function setNativeLiveVoiceEffectAndWait(effectId: VoiceEffectId) {
  setNativeLiveVoiceEffect(effectId);

  if (Platform.OS !== 'android') {
    return;
  }

  const confirmedEffectId = await getNativeLiveVoiceEffect();

  if (confirmedEffectId !== effectId) {
    setNativeLiveVoiceEffect(effectId);
    await getNativeLiveVoiceEffect();
  }
}

export async function confirmNativeLiveVoiceEffectAttached(effectId: VoiceEffectId) {
  await setNativeLiveVoiceEffectAndWait(effectId);

  if (Platform.OS !== 'android') {
    return true;
  }

  const status = await getNativeLiveVoiceEffectStatus();
  return status?.effectId === effectId && status.attached === true && status.factoryInstalled === true;
}

export async function waitForNativeLiveVoiceProcessing(effectId: VoiceEffectId, baselineFrames = 0) {
  if (Platform.OS !== 'android' || effectId === 'normal') {
    return true;
  }

  for (const waitMs of [80, 140, 220, 320, 480, 680]) {
    await delay(waitMs);
    const status = await getNativeLiveVoiceEffectStatus();
    const processedFrames = status?.processedFrames ?? 0;

    if (
      status?.effectId === effectId &&
      status.attached === true &&
      status.factoryInstalled === true &&
      status.lastProcessedEffectId === effectId &&
      processedFrames > baselineFrames
    ) {
      return true;
    }
  }

  return false;
}

export function setCallPictureInPictureEnabled(enabled: boolean) {
  if (Platform.OS !== 'android') {
    return;
  }

  getCallNativeModule()?.setPictureInPictureEnabled?.(enabled);
}

export async function enterCallPictureInPicture() {
  if (Platform.OS !== 'android') {
    return false;
  }

  return getCallNativeModule()?.enterPictureInPicture?.().catch(() => false) ?? false;
}

export async function closeCallPictureInPicture() {
  if (Platform.OS !== 'android') {
    return false;
  }

  return getCallNativeModule()?.closePictureInPicture?.().catch(() => false) ?? false;
}

export function startNativeCallService(mode: 'voice' | 'video', sessionId?: string, voiceEffectId?: VoiceEffectId) {
  if (Platform.OS !== 'android') {
    return;
  }

  getCallNativeModule()?.startCallService?.(mode, sessionId, voiceEffectId);
}

export function setNativeCallAudioRoute(speaker: boolean) {
  if (Platform.OS !== 'android') {
    return;
  }

  getCallNativeModule()?.setCallAudioRoute?.(speaker);
}

export async function getNativeCallAudioRoutes() {
  return getCallNativeModule()?.getCallAudioRoutes?.().catch((): CallAudioRoute[] => []) ?? [];
}

export async function selectNativeCallAudioRoute(routeId: string) {
  return getCallNativeModule()?.selectCallAudioRoute?.(routeId).catch(() => false) ?? false;
}

export function stopNativeCallService(sessionId?: string) {
  getCallNativeModule()?.clearCallAudioRoute?.();

  if (Platform.OS !== 'android') {
    return;
  }

  getCallNativeModule()?.stopCallService?.(sessionId);
}

export function setNativeProximityScreenOffEnabled(enabled: boolean) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  getCallNativeModule()?.setProximityScreenOffEnabled?.(enabled);
}

export function setNativeScreenCaptureProtection(enabled: boolean) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  getCallNativeModule()?.setScreenCaptureProtection?.(enabled);
}

export function setNativeMediaViewerOrientationUnlocked(unlocked: boolean) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  getCallNativeModule()?.setMediaViewerOrientationUnlocked?.(unlocked);
}

export function startNativeIncomingRingtone() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  getCallNativeModule()?.startIncomingRingtone?.();
}

export function stopNativeIncomingRingtone() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  getCallNativeModule()?.stopIncomingRingtone?.();
}

export async function startNativeOutgoingRingback(uri: string, mode: 'voice' | 'video') {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.startOutgoingRingback?.(uri, mode).catch(() => false) ?? false;
}

export function stopNativeOutgoingRingback() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  getCallNativeModule()?.stopOutgoingRingback?.();
}

export function showNativeAndroidIncomingCall(payload: AndroidIncomingCallPayload) {
  if (Platform.OS !== 'android') {
    return;
  }

  getCallNativeModule()?.showIncomingCall?.(payload);
}

export function cancelNativeAndroidIncomingCall(callId: string | null | undefined) {
  if (Platform.OS !== 'android' || !callId) {
    return;
  }

  getCallNativeModule()?.cancelIncomingCall?.(callId);
}

export function cancelNativeMessageNotifications(conversationId: string | null | undefined) {
  if (!conversationId) {
    return;
  }

  getCallNativeModule()?.cancelMessageNotifications?.(conversationId);
}

export async function registerIosVoipPushToken() {
  if (Platform.OS !== 'ios') {
    return null;
  }

  return getCallNativeModule()?.registerVoipPushToken?.().catch(() => null) ?? null;
}

export function endIosCallKitCall(callId: string | null | undefined) {
  if (Platform.OS !== 'ios' || !callId) {
    return;
  }

  getCallNativeModule()?.endCall?.(callId);
}

export async function openNativeAndroidFile(uri: string, mimeType?: string | null) {
  if (Platform.OS !== 'android') {
    return false;
  }

  return getCallNativeModule()?.openFile?.(uri, mimeType ?? null).catch(() => false) ?? false;
}

export async function saveNativeAndroidFile(uri: string, mimeType?: string | null, displayName?: string | null) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.saveFile?.(uri, mimeType ?? null, displayName ?? null).catch(() => false) ?? false;
}

export async function shareNativeAndroidFile(uri: string, mimeType?: string | null, displayName?: string | null) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }

  return getCallNativeModule()?.shareFile?.(uri, mimeType ?? null, displayName ?? null).catch(() => false) ?? false;
}

export async function renderNativeImageDrawing(uri: string, strokes: ImageDrawingStroke[], outputFileName?: string | null) {
  const renderer = getCallNativeModule()?.renderImageDrawing;

  if (!renderer) {
    throw new Error(t('imageDrawingUnavailable'));
  }

  return renderer(uri, JSON.stringify(strokes), outputFileName ?? null);
}
