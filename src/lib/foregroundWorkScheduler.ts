import { InteractionManager } from 'react-native';

const FOREGROUND_IDLE_SETTLE_MS = 180;
let highPriorityActivityUntil = 0;

export function noteHighPriorityUiActivity(durationMs = 700) {
  highPriorityActivityUntil = Math.max(highPriorityActivityUntil, Date.now() + Math.max(0, durationMs));
}

export function isHighPriorityUiActivityActive() {
  return Date.now() < highPriorityActivityUntil;
}

export function scheduleAfterForegroundIdle(
  callback: () => void,
  options?: {
    delayMs?: number;
    shouldRun?: () => boolean;
  },
) {
  let cancelled = false;
  let interaction: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number) => {
    timeout = setTimeout(() => {
      timeout = null;

      if (cancelled || options?.shouldRun?.() === false) {
        return;
      }

      const activityDelay = Math.max(0, highPriorityActivityUntil - Date.now());

      if (activityDelay > 0) {
        schedule(activityDelay + FOREGROUND_IDLE_SETTLE_MS);
        return;
      }

      interaction = InteractionManager.runAfterInteractions(() => {
        interaction = null;

        if (cancelled || options?.shouldRun?.() === false) {
          return;
        }

        const nextActivityDelay = Math.max(0, highPriorityActivityUntil - Date.now());

        if (nextActivityDelay > 0) {
          schedule(nextActivityDelay + FOREGROUND_IDLE_SETTLE_MS);
          return;
        }

        callback();
      });
    }, Math.max(0, delayMs));
  };

  schedule(options?.delayMs ?? 0);

  return () => {
    cancelled = true;
    interaction?.cancel();
    interaction = null;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
}

export async function waitForForegroundIdle() {
  do {
    while (isHighPriorityUiActivityActive()) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(
        FOREGROUND_IDLE_SETTLE_MS,
        highPriorityActivityUntil - Date.now() + FOREGROUND_IDLE_SETTLE_MS,
      )));
    }

    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(resolve);
    });
  } while (isHighPriorityUiActivityActive());
}
