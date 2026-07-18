import { getStoredLockPin } from './storage';

type AppLockStatus = {
  hasLockPin: boolean;
  isUnlocked: boolean;
};

type Listener = () => void;

let status: AppLockStatus = {
  hasLockPin: false,
  isUnlocked: false,
};
let callOnlyAccessCallId: string | null = null;
let callOnlyAccessGraceUntil = 0;
let foregroundOperationDepth = 0;
let foregroundOperationGraceUntil = 0;
let foregroundOperationCurrentAppState = 'active';
let foregroundOperationPendingActiveRelease = false;
let foregroundOperationReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let foregroundOperationMaxTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
const FOREGROUND_OPERATION_GRACE_MS = 2500;
const FOREGROUND_OPERATION_GRACE_TIMER_MS = FOREGROUND_OPERATION_GRACE_MS + 100;
const FOREGROUND_OPERATION_MAX_WAIT_MS = 30_000;

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function addAppLockAccessListener(listener: Listener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function notifyAppLockRouteChanged() {
  notifyListeners();
}

export function updateAppLockStatus(nextStatus: AppLockStatus) {
  const didChange = status.hasLockPin !== nextStatus.hasLockPin || status.isUnlocked !== nextStatus.isUnlocked;
  status = nextStatus;

  if (status.hasLockPin && status.isUnlocked && callOnlyAccessCallId && Date.now() >= callOnlyAccessGraceUntil) {
    callOnlyAccessCallId = null;
  }

  if (didChange) {
    notifyListeners();
  }
}

export function shouldOpenIncomingCallAsCallOnly() {
  return status.hasLockPin && !status.isUnlocked;
}

export async function beginCallOnlyAccessIfLockPinEnabled(callId: string) {
  if (status.hasLockPin && status.isUnlocked) {
    return false;
  }

  beginCallOnlyAccess(callId);

  const lockPin = await getStoredLockPin().catch(() => null);

  if (!lockPin) {
    endCallOnlyAccess(callId);
    return false;
  }

  return true;
}

export function beginCallOnlyAccess(callId: string) {
  if (!callId) {
    return;
  }

  callOnlyAccessGraceUntil = Date.now() + 120_000;
  if (callOnlyAccessCallId === callId) {
    notifyListeners();
    return;
  }

  callOnlyAccessCallId = callId;
  notifyListeners();
}

export function endCallOnlyAccess(callId?: string | null) {
  if (!callOnlyAccessCallId || (callId && callOnlyAccessCallId !== callId)) {
    return;
  }

  callOnlyAccessCallId = null;
  callOnlyAccessGraceUntil = 0;
  notifyListeners();
}

export function getCallOnlyAccessCallId() {
  return callOnlyAccessCallId;
}

export function isCallOnlyAccessActive() {
  return !!callOnlyAccessCallId && Date.now() < callOnlyAccessGraceUntil;
}

export function isCallOnlyAccessFor(callId?: string | null) {
  return !!callOnlyAccessCallId && (!callId || callOnlyAccessCallId === callId);
}

export function beginAppLockForegroundOperation() {
  foregroundOperationDepth += 1;
  foregroundOperationGraceUntil = 0;
  foregroundOperationPendingActiveRelease = false;

  if (foregroundOperationReleaseTimer) {
    clearTimeout(foregroundOperationReleaseTimer);
    foregroundOperationReleaseTimer = null;
  }

  if (foregroundOperationMaxTimer) {
    clearTimeout(foregroundOperationMaxTimer);
    foregroundOperationMaxTimer = null;
  }

  notifyListeners();

  let didEnd = false;

  return () => {
    if (didEnd) {
      return;
    }

    didEnd = true;
    foregroundOperationDepth = Math.max(0, foregroundOperationDepth - 1);

    if (foregroundOperationDepth > 0) {
      notifyListeners();
      return;
    }

    releaseForegroundOperationWhenSafe();
  };
}

export function setAppLockCurrentAppState(nextState: string) {
  foregroundOperationCurrentAppState = nextState;

  if (
    nextState === 'active' &&
    foregroundOperationPendingActiveRelease &&
    foregroundOperationDepth === 0
  ) {
    releaseForegroundOperationWithGrace();
    return;
  }

  notifyListeners();
}

function releaseForegroundOperationWhenSafe() {
  if (foregroundOperationCurrentAppState === 'active') {
    releaseForegroundOperationWithGrace();
    return;
  }

  foregroundOperationGraceUntil = 0;
  foregroundOperationPendingActiveRelease = true;

  if (foregroundOperationMaxTimer) {
    clearTimeout(foregroundOperationMaxTimer);
  }

  foregroundOperationMaxTimer = setTimeout(() => {
    foregroundOperationMaxTimer = null;
    foregroundOperationPendingActiveRelease = false;
    foregroundOperationGraceUntil = 0;
    notifyListeners();
  }, FOREGROUND_OPERATION_MAX_WAIT_MS);

  notifyListeners();
}

function releaseForegroundOperationWithGrace() {
  foregroundOperationPendingActiveRelease = false;
  foregroundOperationGraceUntil = Date.now() + FOREGROUND_OPERATION_GRACE_MS;

  if (foregroundOperationMaxTimer) {
    clearTimeout(foregroundOperationMaxTimer);
    foregroundOperationMaxTimer = null;
  }

  if (foregroundOperationReleaseTimer) {
    clearTimeout(foregroundOperationReleaseTimer);
  }

  foregroundOperationReleaseTimer = setTimeout(() => {
    foregroundOperationReleaseTimer = null;
    notifyListeners();
  }, FOREGROUND_OPERATION_GRACE_TIMER_MS);

  notifyListeners();
}

export function isAppLockForegroundOperationActive() {
  return foregroundOperationDepth > 0 ||
    foregroundOperationPendingActiveRelease ||
    Date.now() < foregroundOperationGraceUntil;
}
