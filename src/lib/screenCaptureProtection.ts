import { setNativeScreenCaptureProtection } from '../native/CallNative';

const protectionReasons = new Map<string, boolean>();
let lastAppliedNativeState: boolean | null = null;
let pendingNativeState: boolean | null = null;
let nativeProtectionTimer: ReturnType<typeof setTimeout> | null = null;

function applyNativeProtectionState(enabled: boolean) {
  pendingNativeState = enabled;

  if (nativeProtectionTimer) {
    clearTimeout(nativeProtectionTimer);
  }

  nativeProtectionTimer = setTimeout(() => {
    nativeProtectionTimer = null;

    if (pendingNativeState === lastAppliedNativeState) {
      return;
    }

    lastAppliedNativeState = pendingNativeState;
    setNativeScreenCaptureProtection(pendingNativeState === true);
  }, 120);
}

export function setScreenCaptureProtectionRequirement(reason: string, enabled: boolean) {
  if (enabled) {
    protectionReasons.set(reason, true);
  } else {
    protectionReasons.delete(reason);
  }

  applyNativeProtectionState([...protectionReasons.values()].some(Boolean));
}

export function clearScreenCaptureProtectionRequirement(reason: string) {
  setScreenCaptureProtectionRequirement(reason, false);
}
