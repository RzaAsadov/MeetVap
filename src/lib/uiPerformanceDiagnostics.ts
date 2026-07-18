import { useEffect } from 'react';

export const UI_PERFORMANCE_DIAGNOSTICS_ENABLED = false;

const JS_STALL_INTERVAL_MS = 500;
const JS_STALL_THRESHOLD_MS = 250;

export function logUiPerformanceDiagnostic(event: string, details: Record<string, unknown> = {}) {
  if (!UI_PERFORMANCE_DIAGNOSTICS_ENABLED) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[MeetVapUIPerf] ${JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...details,
  })}`);
}

export function useUiPerformanceStallMonitor(scope: string, details: Record<string, unknown> = {}) {
  useEffect(() => {
    if (!UI_PERFORMANCE_DIAGNOSTICS_ENABLED) {
      return undefined;
    }

    let expectedAt = Date.now() + JS_STALL_INTERVAL_MS;
    const interval = setInterval(() => {
      const now = Date.now();
      const driftMs = now - expectedAt;

      if (driftMs >= JS_STALL_THRESHOLD_MS) {
        logUiPerformanceDiagnostic('js-thread-stall', {
          ...details,
          driftMs,
          scope,
        });
      }

      expectedAt = now + JS_STALL_INTERVAL_MS;
    }, JS_STALL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [details, scope]);
}
