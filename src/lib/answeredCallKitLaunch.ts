import { Platform } from 'react-native';

import { handleIncomingCallUrl } from '../components/PushNotificationBridge';
import {
  consumeNativePendingIncomingCallUrl,
  peekNativePendingAnsweredCallKitCallId,
  peekNativePendingAnsweredCallKitUrl,
} from '../native/CallNative';
import { beginCallOnlyAccess } from './appLockAccess';
import { getServerUrl } from './storage';
import { useAppStore } from '../store/useAppStore';

const POLL_DELAYS_MS = [0, 80, 160, 320, 640, 1200, 2000];

export type AnsweredCallKitLaunchResult =
  | { status: 'launched'; url: string }
  | { status: 'no-pending' }
  | { status: 'cancelled' };

let launchInFlight: Promise<AnsweredCallKitLaunchResult> | null = null;

export function extractIncomingCallIdFromUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== 'incoming-call') {
      return null;
    }

    return parsed.searchParams.get('callId');
  } catch {
    return null;
  }
}

export function beginCallOnlyAccessFromIncomingCallUrl(url: string) {
  try {
    const parsed = new URL(url);
    const callId = parsed.searchParams.get('callId');
    const isAcceptedIncomingCall = parsed.hostname === 'incoming-call' &&
      parsed.searchParams.get('answeredByNative') === 'true' &&
      !!callId;

    if (isAcceptedIncomingCall) {
      beginCallOnlyAccess(callId);
    }
  } catch {
    // Ignore URLs that do not belong to the incoming-call route.
  }
}

function incomingCallUrlMatchesCallId(url: string | null | undefined, callId: string | null | undefined) {
  if (!url || !callId) {
    return false;
  }

  return extractIncomingCallIdFromUrl(url) === callId;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveAnsweredCallKitLaunchUrl(options?: { isCancelled?: () => boolean }) {
  if (Platform.OS !== 'ios') {
    for (const waitMs of POLL_DELAYS_MS) {
      if (options?.isCancelled?.()) {
        return null;
      }

      if (waitMs > 0) {
        await delay(waitMs);
      }

      const consumedUrl = await consumeNativePendingIncomingCallUrl();

      if (consumedUrl) {
        return consumedUrl;
      }
    }

    return null;
  }

  for (const waitMs of POLL_DELAYS_MS) {
    if (options?.isCancelled?.()) {
      return null;
    }

    if (waitMs > 0) {
      await delay(waitMs);
    }

    const callId = await peekNativePendingAnsweredCallKitCallId();

    if (!callId) {
      continue;
    }

    beginCallOnlyAccess(callId);

    const answeredUrl = await peekNativePendingAnsweredCallKitUrl();

    if (incomingCallUrlMatchesCallId(answeredUrl, callId)) {
      return answeredUrl;
    }
  }

  const callId = await peekNativePendingAnsweredCallKitCallId();

  if (!callId) {
    return null;
  }

  beginCallOnlyAccess(callId);

  const answeredUrl = await peekNativePendingAnsweredCallKitUrl();

  if (incomingCallUrlMatchesCallId(answeredUrl, callId)) {
    return answeredUrl;
  }

  const consumedUrl = await consumeNativePendingIncomingCallUrl();

  if (incomingCallUrlMatchesCallId(consumedUrl, callId)) {
    return consumedUrl;
  }

  return null;
}

export async function launchAnsweredCallKitCallIfPending(options?: { isCancelled?: () => boolean }) {
  if (launchInFlight) {
    return launchInFlight;
  }

  launchInFlight = (async (): Promise<AnsweredCallKitLaunchResult> => {
    const url = await resolveAnsweredCallKitLaunchUrl(options);

    if (options?.isCancelled?.()) {
      return { status: 'cancelled' };
    }

    if (!url) {
      return { status: 'no-pending' };
    }

    beginCallOnlyAccessFromIncomingCallUrl(url);
    const serverUrl = useAppStore.getState().serverUrl ?? await getServerUrl().catch(() => null);
    await handleIncomingCallUrl(url, serverUrl);

    return { status: 'launched', url };
  })().finally(() => {
    launchInFlight = null;
  });

  return launchInFlight;
}
